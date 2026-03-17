import type { RepoConfig } from './config/repos.js';
import { loadSettings } from './config/settings.js';
import type { TaskStore } from './approval/queue.js';
import type { AuditLogger } from './audit/logger.js';
import type { TaskRequest, ValidationResult } from './types/task.js';
import type { ExecutorContext } from './tools/executor.js';
import { runClaudeCodeWorker } from './workers/claude-code.js';
import { dispatchInvestigationWorkers, dispatchValidationWorkers } from './workers/cowork-dispatch.js';
import { synthesizeResults } from './workers/synthesis.js';
import { runValidation } from './validation/runner.js';
import { applyPatch } from './approval/actions.js';
import type { WorkerResult } from './types/worker.js';

export async function runTaskPipeline(
  taskId: string,
  request: TaskRequest,
  taskStore: TaskStore,
  repoConfig: RepoConfig,
  audit: AuditLogger,
  broadcast: (taskId: string, event: any) => void,
): Promise<void> {
  const settings = loadSettings();
  const state = taskStore.get(taskId);
  if (!state) throw new Error(`Task not found: ${taskId}`);

  const ctx: ExecutorContext = {
    taskId,
    worktreePath: state.worktreePath,
    repoConfig,
    audit,
    actor: 'claude-code',
    readOnly: false,
  };

  try {
    // Phase 1: Investigation
    taskStore.transition(taskId, 'investigating');
    broadcast(taskId, { type: 'progress', taskId, phase: 'investigating', message: 'Starting analysis...' });

    // Run Claude Code and Cowork workers in parallel
    const [claudeCodeResult, coworkResults] = await Promise.all([
      runClaudeCodeWorker(
        taskId, ctx, request, state.worktreeBranch,
        (msg) => broadcast(taskId, { type: 'progress', taskId, phase: 'investigating', worker: 'claude-code', message: msg }),
      ),
      dispatchInvestigationWorkers(
        taskId, request.description, ctx,
        (worker, msg) => broadcast(taskId, { type: 'progress', taskId, phase: 'investigating', worker, message: msg }),
      ),
    ]);

    // Store results
    const allResults = [claudeCodeResult, ...coworkResults];
    taskStore.update(taskId, { workerResults: allResults });

    for (const wr of allResults) {
      broadcast(taskId, { type: 'worker_complete', taskId, worker: wr.workerType, status: wr.status, summary: wr.workerType });
    }

    // Phase 2: Synthesis
    taskStore.transition(taskId, 'synthesizing');
    broadcast(taskId, { type: 'progress', taskId, phase: 'synthesizing', message: 'Merging results...' });

    const synthesis = synthesizeResults(claudeCodeResult, coworkResults);
    taskStore.update(taskId, { synthesis });

    broadcast(taskId, { type: 'synthesis_complete', taskId, confidence: synthesis.confidence, recommendation: synthesis.recommendation });

    // Extract diagnosis and patch from Claude Code result
    const ccResult = claudeCodeResult.result as any;
    if (ccResult?.diagnosis) {
      taskStore.update(taskId, { diagnosis: ccResult.diagnosis });
    }
    if (ccResult?.patch) {
      taskStore.update(taskId, { patch: ccResult.patch });

      // Apply patch to worktree
      applyPatch(state.worktreePath, ccResult.patch.files);
      audit.log(taskId, 'patch_applied', 'gateway', { files: ccResult.patch.files.length });
    }

    enforceClaudeWorkerResult(taskId, request, claudeCodeResult, ccResult);

    // Phase 3: Validation
    taskStore.transition(taskId, 'validating');
    broadcast(taskId, { type: 'progress', taskId, phase: 'validating', message: 'Running tests and validation...' });

    const patchModifiedPkg = ccResult?.patch?.files?.some((f: any) => f.path === 'package.json' || f.path === 'package-lock.json') || false;
    const validation = await runValidation(
      state.worktreePath,
      repoConfig,
      audit,
      taskId,
      patchModifiedPkg,
      request.acceptanceCommands || [],
    );

    // Run validation workers if patch exists
    if (ccResult?.patch) {
      const diff = ccResult.patch.files.map((f: any) => f.diff || '').join('\n');
      const valWorkerResults = await dispatchValidationWorkers(
        taskId, request.description, diff, ccResult.patch.description || '',
        ctx,
        (worker, msg) => broadcast(taskId, { type: 'progress', taskId, phase: 'validating', worker, message: msg }),
      );

      // Add review result to validation
      const reviewWorker = valWorkerResults.find(w => w.workerType === 'review' && w.status === 'completed');
      if (reviewWorker?.result) {
        const reviewResult = reviewWorker.result as any;
        validation.diffReview = {
          approved: reviewResult.approved ?? true,
          concerns: reviewResult.concerns || [],
          suggestions: reviewResult.suggestions || [],
        };
        if (reviewResult.concerns?.some((c: any) => c.severity === 'critical')) {
          validation.overallPass = false;
        }
      }

      // Store all worker results
      const currentState = taskStore.get(taskId)!;
      taskStore.update(taskId, {
        workerResults: [...currentState.workerResults, ...valWorkerResults],
      });
    }

    taskStore.update(taskId, { validation });
    enforceValidationResult(request, validation);
    broadcast(taskId, { type: 'validation_complete', taskId, passed: validation.overallPass });

    // Phase 4: Awaiting Approval
    const now = new Date();
    const expiresAt = new Date(now.getTime() + settings.approvalTimeoutMs).toISOString();

    taskStore.transition(taskId, 'awaiting_approval');
    taskStore.update(taskId, {
      approval: {
        required: true,
        availableActions: [
          { id: 'apply_and_commit', label: 'Apply & Commit', description: 'Merge fix to branch and commit' },
          { id: 'apply_commit_and_pr', label: 'Apply, Commit & PR', description: 'Merge, commit, push, and open PR' },
          { id: 'reject', label: 'Reject', description: 'Discard the fix' },
        ],
        requestedAt: now.toISOString(),
        expiresAt,
      },
    });

    audit.log(taskId, 'approval_requested', 'gateway', { expiresAt });

    const updatedState = taskStore.get(taskId)!;
    broadcast(taskId, {
      type: 'approval_required',
      taskId,
      payload: {
        taskId,
        status: 'awaiting_approval',
        summary: updatedState.diagnosis?.summary || request.description,
        diagnosis: updatedState.diagnosis,
        patch: updatedState.patch ? {
          diffStat: updatedState.patch.diffStat,
          diff: updatedState.patch.files.map(f => f.diff).join('\n'),
        } : null,
        validation: {
          tests: updatedState.validation?.tests ? { passed: updatedState.validation.tests.passed, failed: updatedState.validation.tests.failed } : null,
          lint: updatedState.validation?.lint ? { errors: updatedState.validation.lint.errors, warnings: updatedState.validation.lint.warnings } : null,
          build: updatedState.validation?.build ? { success: updatedState.validation.build.success } : null,
          acceptanceChecks: updatedState.validation?.acceptanceChecks || [],
          diffReview: updatedState.validation?.diffReview,
          overallPass: updatedState.validation?.overallPass,
        },
        synthesis: updatedState.synthesis,
        availableActions: updatedState.approval?.availableActions,
        expiresAt,
      },
    });

  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`Pipeline failed for ${taskId}:`, error);
    audit.log(taskId, 'worker_failed', 'gateway', { phase: 'pipeline', error });
    try {
      taskStore.transition(taskId, 'failed');
    } catch {}
    broadcast(taskId, { type: 'task_failed', taskId, error });
  }
}

function enforceClaudeWorkerResult(
  taskId: string,
  request: TaskRequest,
  worker: WorkerResult,
  result: any,
): void {
  if (worker.status !== 'completed' || !result) {
    throw new Error(`Claude worker did not complete usable work for ${taskId}`);
  }

  const diagnosis = result.diagnosis;
  if (!diagnosis?.summary || !diagnosis?.rootCause) {
    throw new Error('Claude worker returned an incomplete diagnosis');
  }
  if (!Array.isArray(diagnosis.evidence) || diagnosis.evidence.length === 0) {
    throw new Error('Claude worker returned no concrete evidence');
  }

  const metadata = worker.metadata;
  if (!metadata || metadata.toolCallCount === 0) {
    throw new Error('Claude worker made no tool calls');
  }
  if (metadata.filesRead.length === 0 && metadata.commandsRun.length === 0) {
    throw new Error('Claude worker produced no inspection evidence');
  }

  const requestedFiles = (request.files || []).map(normalizePath);
  const touchedFiles = new Set(metadata.focusedFilesTouched.map(normalizePath));
  const missingFocusedFiles = requestedFiles.filter(file => !touchedFiles.has(file));
  if (missingFocusedFiles.length > 0) {
    throw new Error(`Claude worker did not inspect required files: ${missingFocusedFiles.join(', ')}`);
  }

  const patchFiles = Array.isArray(result.patch?.files) ? result.patch.files : [];
  if (request.type === 'fix' && patchFiles.length === 0) {
    throw new Error('Fix task produced no code changes');
  }
}

function enforceValidationResult(request: TaskRequest, validation: ValidationResult): void {
  if (!validation.overallPass) {
    throw new Error('Validation failed');
  }

  if ((request.acceptanceCommands || []).length > 0) {
    const failed = validation.acceptanceChecks.filter(check => !check.success);
    if (failed.length > 0) {
      throw new Error(`Acceptance checks failed: ${failed.map(check => check.command).join(', ')}`);
    }
  }
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\/+/, '');
}
