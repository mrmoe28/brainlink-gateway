import { Router } from 'express';
import { z } from 'zod';
import { TaskStore } from '../approval/queue.js';
import { applyPatch, commitChanges, mergeWorktreeBranch, pushBranch, openPR, rollbackCommit } from '../approval/actions.js';
import { removeWorktree, listWorktrees } from '../workspace/worktree.js';
import type { RepoRegistry } from '../config/repos.js';
import type { AuditLogger } from '../audit/logger.js';
import { runTaskPipeline } from '../pipeline.js';
import { loadSettings } from '../config/settings.js';
import { hasGithubAuth, resolveRepoSource } from '../workspace/repo-source.js';

const ModexTaskRequestSchema = z.object({
  repo: z.string().min(1),
  taskType: z.enum(['diagnose', 'fix', 'review', 'build', 'test']).optional(),
  type: z.enum(['diagnose', 'fix', 'investigate', 'test', 'review']).optional(),
  prompt: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  files: z.array(z.string()).optional(),
  conversationId: z.string().nullable().optional(),
  source: z.string().min(1).optional(),
  provider: z.enum(['openai', 'lmstudio', 'ollama', 'llama-rpc']).optional(),
  model: z.string().min(1).optional(),
  requestedActions: z.array(z.string()).optional(),
});

const ModexDecisionSchema = z.object({
  notes: z.string().optional(),
  requestedActions: z.array(z.string()).optional(),
});

function normalizeModexTaskType(value?: string): 'diagnose' | 'fix' | 'review' | 'build' | 'test' {
  if (!value) return 'fix';
  if (value === 'investigate') return 'diagnose';
  if (value === 'diagnose' || value === 'fix' || value === 'review' || value === 'build' || value === 'test') return value;
  return 'fix';
}

async function proxyModex(settings: ReturnType<typeof loadSettings>, pathname: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Content-Type', 'application/json');
  if (settings.modexBridgeToken) {
    headers.set('Authorization', 'Bearer ' + settings.modexBridgeToken);
  }
  const response = await fetch(settings.modexBridgeUrl + pathname, {
    ...init,
    headers,
  });
  const text = await response.text();
  const body = text
    ? (() => {
        try {
          return JSON.parse(text);
        } catch {
          return { error: text };
        }
      })()
    : null;
  return { response, body };
}

const TaskRequestSchema = z.object({
  type: z.enum(['diagnose', 'fix', 'investigate', 'test', 'review']),
  repo: z.string().min(1),
  repoUrl: z.string().url().optional(),
  description: z.string().min(1),
  files: z.array(z.string()).optional(),
  branch: z.string().optional(),
  doneWhen: z.array(z.string().min(1)).optional(),
  constraints: z.array(z.string().min(1)).optional(),
  outputFormat: z.string().min(1).optional(),
  acceptanceCommands: z.array(z.string().min(1)).optional(),
  priority: z.enum(['normal', 'urgent']).default('normal'),
});

const ApproveSchema = z.object({
  action: z.enum(['apply_and_commit', 'apply_commit_and_pr', 'reject']),
  commitMessage: z.string().optional(),
});

export function createRouter(
  taskStore: TaskStore,
  repoRegistry: RepoRegistry,
  audit: AuditLogger,
  broadcast: (taskId: string, event: any) => void,
  startTime: number,
): Router {
  const router = Router();
  const settings = loadSettings();

  // POST /api/tasks
  router.post('/api/tasks', async (req, res) => {
    try {
      const body = TaskRequestSchema.parse(req.body);
      const repoSource = resolveRepoSource(repoRegistry, { repo: body.repo, repoUrl: body.repoUrl, branch: body.branch }, settings);
      const repoConfig = repoSource.repoConfig;
      repoRegistry[repoSource.repoKey] = repoConfig;

      // Import dynamically to avoid circular deps
      const { generateTaskId } = await import('../workspace/branch.js');
      const { createWorktree } = await import('../workspace/worktree.js');

      const taskId = generateTaskId();
      const sourceBranch = body.branch || repoConfig.defaultBranch;
      const worktreeInfo = createWorktree(repoConfig.path, taskId, body.description, sourceBranch, audit, repoConfig.maxWorktrees);

      const taskState = taskStore.create(taskId, body, worktreeInfo.path, worktreeInfo.branch);
      taskStore.update(taskId, { repo: repoSource.repoKey, repoUrl: repoSource.repoUrl });
      audit.log(taskId, 'task_created', 'gateway', {
        repo: repoSource.repoKey,
        repoUrl: repoSource.repoUrl,
        type: body.type,
        cloned: repoSource.cloned,
      });

      // Start pipeline async (don't await)
      runTaskPipeline(taskId, { ...body, repo: repoSource.repoKey }, taskStore, repoConfig, audit, broadcast).catch(err => {
        console.error(`Pipeline error for ${taskId}:`, err);
        try { taskStore.transition(taskId, 'failed'); } catch {}
      });

      res.status(201).json({
        taskId,
        status: taskState.status,
        worktreeBranch: worktreeInfo.branch,
        createdAt: taskState.createdAt,
        repo: repoSource.repoKey,
        repoUrl: repoSource.repoUrl,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation error', details: err.issues });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // GET /api/tasks/:id
  router.get('/api/tasks/:id', (req, res) => {
    const state = taskStore.get(req.params.id);
    if (!state) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }
    res.json(state);
  });

  // POST /api/tasks/:id/approve
  router.post('/api/tasks/:id/approve', async (req, res) => {
    try {
      const { id } = req.params;
      const body = ApproveSchema.parse(req.body);
      const state = taskStore.get(id);
      if (!state) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }
      if (state.status !== 'awaiting_approval' && state.status !== 'expired') {
        res.status(400).json({ error: `Task is not awaiting approval (status: ${state.status})` });
        return;
      }

      if (body.action === 'reject') {
        taskStore.transition(id, 'rejected');
        const repoConfig = repoRegistry[state.repo];
        if (repoConfig) {
          removeWorktree(repoConfig.path, id, state.worktreeBranch, audit);
        }
        audit.log(id, 'approval_rejected', 'user', {});
        broadcast(id, { type: 'task_complete', taskId: id, status: 'rejected' });
        res.json({ taskId: id, status: 'rejected' });
        return;
      }

      // Apply and commit
      taskStore.transition(id, 'applying');
      const repoConfig = repoRegistry[state.repo];
      if (!repoConfig) {
        res.status(400).json({ error: 'Repo config not found' });
        return;
      }

      // Commit in worktree first
      const message = body.commitMessage || `Brain Link: ${state.diagnosis?.summary || state.worktreeBranch}`;
      const sha = commitChanges(state.worktreePath, message, audit, id);

      // Merge to main branch
      mergeWorktreeBranch(repoConfig.path, state.worktreeBranch, message);

      let prUrl: string | undefined;
      if (body.action === 'apply_commit_and_pr') {
        pushBranch(repoConfig.path, state.worktreeBranch, audit, id);
        prUrl = openPR(repoConfig.path, state.diagnosis?.summary || 'Brain Link fix', message, audit, id);
      }

      // Cleanup worktree
      removeWorktree(repoConfig.path, id, state.worktreeBranch, audit);

      taskStore.transition(id, 'completed');
      taskStore.update(id, {
        approval: {
          required: true,
          availableActions: [],
          requestedAt: state.approval?.requestedAt || new Date().toISOString(),
          expiresAt: state.approval?.expiresAt || new Date().toISOString(),
          decidedAt: new Date().toISOString(),
          decision: 'approved',
          chosenAction: body.action,
          commitSha: sha,
          prUrl,
        },
      });

      audit.log(id, 'approval_granted', 'user', { action: body.action, sha });
      broadcast(id, { type: 'task_complete', taskId: id, status: 'completed' });

      res.json({ taskId: id, status: 'completed', commitSha: sha, prUrl });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // POST /api/tasks/:id/rollback
  router.post('/api/tasks/:id/rollback', (req, res) => {
    try {
      const state = taskStore.get(req.params.id);
      if (!state) {
        res.status(404).json({ error: 'Task not found' });
        return;
      }

      const repoConfig = repoRegistry[state.repo];
      if (!repoConfig) {
        res.status(400).json({ error: 'Repo config not found' });
        return;
      }

      if (state.approval?.commitSha) {
        const revertSha = rollbackCommit(repoConfig.path, state.approval.commitSha, audit, req.params.id);
        taskStore.transition(req.params.id, 'rolled_back');
        res.json({ taskId: req.params.id, status: 'rolled_back', rollbackMethod: 'git_revert', revertSha });
      } else {
        removeWorktree(repoConfig.path, req.params.id, state.worktreeBranch, audit);
        taskStore.transition(req.params.id, 'rolled_back');
        res.json({ taskId: req.params.id, status: 'rolled_back', rollbackMethod: 'worktree_discard' });
      }
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // POST /api/modex/tasks
  router.post('/api/modex/tasks', async (req, res) => {
    try {
      const body = ModexTaskRequestSchema.parse(req.body);
      const payload = {
        repo: body.repo,
        taskType: normalizeModexTaskType(body.taskType || body.type),
        prompt: body.prompt || body.description,
        files: body.files,
        conversationId: body.conversationId,
        source: body.source || 'brain-link-gateway',
        provider: body.provider,
        model: body.model,
        requestedActions: body.requestedActions,
      };
      const { response, body: result } = await proxyModex(settings, '/api/bridge/tasks', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      res.status(response.status).json(result);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation error', details: err.issues });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // GET /api/modex/tasks/:id
  router.get('/api/modex/tasks/:id', async (req, res) => {
    try {
      const { response, body } = await proxyModex(settings, '/api/bridge/tasks/' + encodeURIComponent(req.params.id), {
        method: 'GET',
      });
      res.status(response.status).json(body);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // POST /api/modex/tasks/:id/approve
  router.post('/api/modex/tasks/:id/approve', async (req, res) => {
    try {
      const body = ModexDecisionSchema.parse(req.body || {});
      const { response, body: result } = await proxyModex(
        settings,
        '/api/bridge/tasks/' + encodeURIComponent(req.params.id) + '/approve',
        {
          method: 'POST',
          body: JSON.stringify(body),
        }
      );
      res.status(response.status).json(result);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation error', details: err.issues });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // POST /api/modex/tasks/:id/reject
  router.post('/api/modex/tasks/:id/reject', async (req, res) => {
    try {
      const body = ModexDecisionSchema.parse(req.body || {});
      const { response, body: result } = await proxyModex(
        settings,
        '/api/bridge/tasks/' + encodeURIComponent(req.params.id) + '/reject',
        {
          method: 'POST',
          body: JSON.stringify(body),
        }
      );
      res.status(response.status).json(result);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ error: 'Validation error', details: err.issues });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // GET /api/repos
  router.get('/api/repos', (_req, res) => {
    const repos = Object.entries(repoRegistry).map(([key, config]) => ({
      key,
      path: config.path,
      defaultBranch: config.defaultBranch,
      activeWorktrees: listWorktrees(config.path).length,
    }));
    res.json({
      repos,
      dynamic: {
        defaultOwner: settings.githubDefaultOwner,
        reposBaseDir: settings.reposBaseDir,
      },
    });
  });

  // GET /api/health
  router.get('/api/health', (_req, res) => {
    const allTasks = taskStore.list();
    res.json({
      status: 'ok',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      activeWorktrees: allTasks.filter(t => ['investigating', 'synthesizing', 'validating', 'awaiting_approval'].includes(t.status)).length,
      pendingApprovals: allTasks.filter(t => t.status === 'awaiting_approval').length,
      githubAuth: {
        configured: hasGithubAuth(settings),
        defaultOwner: settings.githubDefaultOwner,
      },
    });
  });

  return router;
}
