import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildClaudeCodePrompt } from './prompts/claude-code.js';
import { CLAUDE_CODE_TOOLS } from '../tools/definitions.js';
import { executeTool, type ExecutorContext } from '../tools/executor.js';
import type { Diagnosis, Patch, PatchFile } from '../types/task.js';
import type { WorkerResult } from '../types/worker.js';
import { loadSettings } from '../config/settings.js';
import type { TaskRequest } from '../types/task.js';

interface ClaudeCodeOutput {
  diagnosis: Diagnosis;
  patch: Patch;
  additionalIssues: string[];
}

export async function runClaudeCodeWorker(
  taskId: string,
  ctx: ExecutorContext,
  request: TaskRequest,
  branchName: string,
  onProgress?: (msg: string) => void,
): Promise<WorkerResult> {
  const settings = loadSettings();
  const client = new Anthropic({ apiKey: settings.anthropicApiKey });
  const startTime = Date.now();
  let totalTokens = 0;

  ctx.audit.log(taskId, 'worker_started', 'gateway', {
    workerType: 'claude-code',
    model: settings.models.claudeCode,
  });

  const systemPrompt = buildClaudeCodePrompt({
    taskType: request.type,
    repoName: request.repo,
    branchName,
    description: request.description,
    focusFiles: request.files || [],
    doneWhen: request.doneWhen,
    constraints: request.constraints,
    outputFormat: request.outputFormat,
    acceptanceCommands: request.acceptanceCommands,
  });
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: request.description }];

  // Track files written by the worker so we can backfill patch content
  const writtenFiles = new Map<string, string>(); // relative path -> content written
  const focusFiles = new Set((request.files || []).map(normalizePath));
  const metadata = {
    toolsUsed: new Set<string>(),
    filesRead: new Set<string>(),
    filesWritten: new Set<string>(),
    commandsRun: new Set<string>(),
    focusedFilesTouched: new Set<string>(),
    toolCallCount: 0,
  };

  try {
    let loopCount = 0;
    while (loopCount < settings.maxToolLoops) {
      loopCount++;
      const response = await withIdleTimeout(
        client.messages.create({
          model: settings.models.claudeCode,
          max_tokens: 4096,
          system: systemPrompt,
          tools: CLAUDE_CODE_TOOLS as Anthropic.Tool[],
          messages,
        }),
        settings.workerIdleTimeoutMs,
      );

      totalTokens += (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

      if (response.stop_reason === 'end_turn') {
        const textContent = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('');

        const result = extractJson<ClaudeCodeOutput>(textContent);

        // Backfill patch files: if the worker returned placeholder content
        // but actually wrote the file via write_file, read the real content from disk
        if (result.patch?.files) {
          backfillPatchContent(result.patch.files, writtenFiles, ctx.worktreePath);
        }

        ctx.audit.log(taskId, 'worker_completed', 'gateway', {
          workerType: 'claude-code',
          tokensUsed: totalTokens,
          toolLoops: loopCount,
        });

        return {
          workerId: `${taskId}_claude-code`,
          workerType: 'claude-code',
          status: 'completed',
          model: settings.models.claudeCode,
          result,
          tokensUsed: totalTokens,
          durationMs: Date.now() - startTime,
          metadata: serializeMetadata(metadata),
        };
      }

      if (response.stop_reason === 'tool_use') {
        const toolBlocks = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const tool of toolBlocks) {
          onProgress?.(`Tool: ${tool.name}`);
          recordToolUsage(metadata, focusFiles, tool.name, tool.input as Record<string, unknown>);

          // Track write_file calls
          if (tool.name === 'write_file') {
            const input = tool.input as Record<string, unknown>;
            const filePath = input.path as string;
            const content = input.content as string;
            if (filePath && content) {
              writtenFiles.set(filePath, content);
            }
          }

          const result = await executeTool(tool.name, tool.input as Record<string, unknown>, ctx);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tool.id,
            content: result.success ? result.output : `ERROR: ${result.error}`,
          });
        }
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults });
      }
    }
    throw new Error(`Max tool loops (${settings.maxToolLoops}) exceeded`);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    ctx.audit.log(taskId, 'worker_failed', 'gateway', { workerType: 'claude-code', error, tokensUsed: totalTokens });
    return {
      workerId: `${taskId}_claude-code`,
      workerType: 'claude-code',
      status: 'failed',
      model: settings.models.claudeCode,
      result: null,
      tokensUsed: totalTokens,
      durationMs: Date.now() - startTime,
      error,
      metadata: serializeMetadata(metadata),
    };
  }
}

function withIdleTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`Worker idle timeout after ${timeoutMs}ms without progress`)), timeoutMs);
    }),
  ]);
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function recordToolUsage(
  metadata: {
    toolsUsed: Set<string>;
    filesRead: Set<string>;
    filesWritten: Set<string>;
    commandsRun: Set<string>;
    focusedFilesTouched: Set<string>;
    toolCallCount: number;
  },
  focusFiles: Set<string>,
  toolName: string,
  input: Record<string, unknown>,
): void {
  metadata.toolsUsed.add(toolName);
  metadata.toolCallCount += 1;

  const touchPath = (value: unknown, target: Set<string>) => {
    if (typeof value !== 'string' || !value.trim()) return;
    const normalized = normalizePath(value);
    target.add(normalized);
    if (focusFiles.has(normalized)) metadata.focusedFilesTouched.add(normalized);
  };

  if (toolName === 'read_file' || toolName === 'git_blame' || toolName === 'git_log') {
    touchPath(input.path, metadata.filesRead);
  } else if (toolName === 'search_content') {
    touchPath(input.path, metadata.filesRead);
  } else if (toolName === 'write_file') {
    touchPath(input.path, metadata.filesWritten);
  } else if (toolName === 'run_command' && typeof input.command === 'string') {
    metadata.commandsRun.add(input.command);
  }
}

function serializeMetadata(metadata: {
  toolsUsed: Set<string>;
  filesRead: Set<string>;
  filesWritten: Set<string>;
  commandsRun: Set<string>;
  focusedFilesTouched: Set<string>;
  toolCallCount: number;
}) {
  return {
    toolsUsed: [...metadata.toolsUsed],
    filesRead: [...metadata.filesRead],
    filesWritten: [...metadata.filesWritten],
    commandsRun: [...metadata.commandsRun],
    focusedFilesTouched: [...metadata.focusedFilesTouched],
    toolCallCount: metadata.toolCallCount,
  };
}

function extractJson<T>(text: string): T {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) return JSON.parse(codeBlockMatch[1]);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return JSON.parse(jsonMatch[0]);
  throw new Error('No JSON found in worker response');
}

/**
 * Workers sometimes return placeholder text in patch.files[].after instead of
 * the actual file content (e.g. "full content written above"). This function
 * backfills from two sources:
 *   1. The content captured during write_file tool calls (writtenFiles map)
 *   2. The actual file on disk in the worktree (fallback)
 */
function backfillPatchContent(
  files: PatchFile[],
  writtenFiles: Map<string, string>,
  worktreePath: string,
): void {
  for (const file of files) {
    if (file.action === 'delete') continue;

    const isPlaceholder = !file.after ||
      file.after.length < 100 ||
      file.after.includes('full content written above') ||
      file.after.includes('content written above') ||
      file.after.includes('(full content');

    if (isPlaceholder) {
      // Try captured write_file content first
      const captured = writtenFiles.get(file.path);
      if (captured) {
        file.after = captured;
        continue;
      }

      // Fall back to reading from disk
      try {
        const fullPath = path.resolve(worktreePath, file.path);
        file.after = readFileSync(fullPath, 'utf-8');
      } catch {
        // File doesn't exist on disk either — leave as-is
      }
    }
  }
}
