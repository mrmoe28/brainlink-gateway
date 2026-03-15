import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import path from 'node:path';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRouter } from '../../src/api/router.js';
import { authMiddleware } from '../../src/security/auth.js';
import { TaskStore } from '../../src/approval/queue.js';
import { AuditLogger } from '../../src/audit/logger.js';
import { broadcast } from '../../src/api/websocket.js';
import type { RepoRegistry } from '../../src/config/repos.js';

const TEST_REPO = 'test/tmp-e2e-repo';
const TEST_LOGS = 'test/tmp-e2e-logs';
const TEST_TASKS = 'test/tmp-e2e-tasks';
const SECRET = 'e2e-test-secret-key';

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

let app: express.Express;
let taskStore: TaskStore;
let audit: AuditLogger;
let repoRegistry: RepoRegistry;

beforeAll(() => {
  // Clean up any leftover dirs
  rmSync(TEST_REPO, { recursive: true, force: true });
  rmSync(TEST_LOGS, { recursive: true, force: true });
  rmSync(TEST_TASKS, { recursive: true, force: true });

  // Create test git repo
  mkdirSync(`${TEST_REPO}/src`, { recursive: true });
  execFileSync('git', ['init'], { cwd: TEST_REPO });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: TEST_REPO });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: TEST_REPO });
  writeFileSync(
    `${TEST_REPO}/src/handler.ts`,
    `export function getUser(id: string) {\n  return users[id].name; // potential null ref\n}\n`,
  );
  writeFileSync(
    `${TEST_REPO}/package.json`,
    JSON.stringify({ name: 'test-e2e', scripts: { test: 'echo "no tests"' } }),
  );
  execFileSync('git', ['add', '-A'], { cwd: TEST_REPO });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: TEST_REPO });

  // Create services
  audit = new AuditLogger(TEST_LOGS);
  taskStore = new TaskStore(TEST_TASKS);

  // Repo registry pointing at the temp repo
  const resolvedPath = path.resolve(TEST_REPO);
  repoRegistry = {
    'test-repo': {
      path: resolvedPath,
      defaultBranch: 'master',
      allowedCommands: ['npm test', 'echo hello'],
      blockedPaths: ['.env'],
      maxWorktrees: 10,
    },
  };

  // Build Express app (mirrors src/index.ts but in-process)
  app = express();
  app.use(express.json());

  // Public health endpoint (before auth middleware)
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptime: 0, activeWorktrees: 0, pendingApprovals: 0 });
  });

  // Protected routes
  app.use(authMiddleware(SECRET));
  app.use(createRouter(taskStore, repoRegistry, audit, broadcast, Date.now()));
});

afterAll(() => {
  // Clean up worktrees before removing the repo
  try {
    execFileSync('git', ['worktree', 'prune'], { cwd: TEST_REPO });
  } catch { /* ignore */ }
  rmSync(TEST_REPO, { recursive: true, force: true });
  rmSync(TEST_LOGS, { recursive: true, force: true });
  rmSync(TEST_TASKS, { recursive: true, force: true });
});

describe('E2E: API Flow', () => {
  it('GET /api/health returns 200 without auth', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('returns 401 without auth header on protected routes', async () => {
    const res = await request(app).get('/api/repos');
    expect(res.status).toBe(401);
  });

  it('returns 401 with wrong auth key', async () => {
    const res = await request(app)
      .get('/api/repos')
      .set('X-Gateway-Key', 'wrong-key');
    expect(res.status).toBe(401);
  });

  it('GET /api/repos returns repo list', async () => {
    const res = await request(app)
      .get('/api/repos')
      .set('X-Gateway-Key', SECRET);
    expect(res.status).toBe(200);
    expect(res.body.repos).toHaveLength(1);
    expect(res.body.repos[0].key).toBe('test-repo');
  });

  it('POST /api/tasks creates a task', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('X-Gateway-Key', SECRET)
      .send({
        type: 'fix',
        repo: 'test-repo',
        description: 'Fix null reference in getUser handler',
        priority: 'normal',
      });
    expect(res.status).toBe(201);
    expect(res.body.taskId).toBeTruthy();
    expect(res.body.worktreeBranch).toContain('brainlink/');

    // Task should exist in store
    const state = taskStore.get(res.body.taskId);
    expect(state).toBeTruthy();
    expect(state!.repo).toBe('test-repo');
  });

  it('GET /api/tasks/:id returns task state', async () => {
    // Create a task first
    const createRes = await request(app)
      .post('/api/tasks')
      .set('X-Gateway-Key', SECRET)
      .send({
        type: 'diagnose',
        repo: 'test-repo',
        description: 'Diagnose handler issue',
        priority: 'normal',
      });
    const taskId = createRes.body.taskId;

    const res = await request(app)
      .get(`/api/tasks/${taskId}`)
      .set('X-Gateway-Key', SECRET);
    expect(res.status).toBe(200);
    expect(res.body.taskId).toBe(taskId);
  });

  it('returns 404 for unknown task', async () => {
    const res = await request(app)
      .get('/api/tasks/nonexistent')
      .set('X-Gateway-Key', SECRET);
    expect(res.status).toBe(404);
  });

  it('rejects invalid task type', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('X-Gateway-Key', SECRET)
      .send({ type: 'invalid', repo: 'test-repo', description: 'x', priority: 'normal' });
    expect(res.status).toBe(400);
  });

  it('rejects missing description', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('X-Gateway-Key', SECRET)
      .send({ type: 'fix', repo: 'test-repo', priority: 'normal' });
    expect(res.status).toBe(400);
  });

  it('rejects unknown repo', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('X-Gateway-Key', SECRET)
      .send({
        type: 'fix',
        repo: 'nonexistent-repo',
        description: 'Fix something',
        priority: 'normal',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Unknown repo');
  });

  it('POST /api/tasks/:id/approve rejects a task', async () => {
    // Create a task via API (pipeline will fail async without API key)
    const createRes = await request(app)
      .post('/api/tasks')
      .set('X-Gateway-Key', SECRET)
      .send({
        type: 'fix',
        repo: 'test-repo',
        description: 'Fix for approval test',
        priority: 'normal',
      });
    const taskId = createRes.body.taskId;

    // Wait for the async pipeline to fail and transition to 'failed'
    await delay(500);

    // Force state to awaiting_approval (bypassing transition validation
    // since the pipeline already moved it to failed)
    taskStore.update(taskId, { status: 'awaiting_approval' });

    // Reject via API
    const res = await request(app)
      .post(`/api/tasks/${taskId}/approve`)
      .set('X-Gateway-Key', SECRET)
      .send({ action: 'reject' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');

    // Verify state persisted
    const state = taskStore.get(taskId);
    expect(state!.status).toBe('rejected');
  });

  it('approve rejects task not in awaiting_approval state', async () => {
    // Create a task directly in the store (no API call, no pipeline)
    const taskId = 'task_wrongstate';
    taskStore.create(taskId, {
      type: 'fix',
      repo: 'test-repo',
      description: 'Wrong state approval test',
      priority: 'normal',
    }, '/tmp/fake', 'brainlink/task_wrongstate/wrong-state');

    // Task is pending — approve should fail
    const res = await request(app)
      .post(`/api/tasks/${taskId}/approve`)
      .set('X-Gateway-Key', SECRET)
      .send({ action: 'reject' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('not awaiting approval');
  });

  it('POST /api/tasks/:id/rollback discards worktree for unapplied task', async () => {
    const createRes = await request(app)
      .post('/api/tasks')
      .set('X-Gateway-Key', SECRET)
      .send({
        type: 'fix',
        repo: 'test-repo',
        description: 'Rollback test',
        priority: 'normal',
      });
    const taskId = createRes.body.taskId;

    // Wait for the async pipeline to fail
    await delay(500);

    // Task should now be in 'failed' state — rollback is valid from failed
    const state = taskStore.get(taskId);
    expect(state!.status).toBe('failed');

    const res = await request(app)
      .post(`/api/tasks/${taskId}/rollback`)
      .set('X-Gateway-Key', SECRET);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rolled_back');
    expect(res.body.rollbackMethod).toBe('worktree_discard');
  });

  it('rollback returns 404 for unknown task', async () => {
    const res = await request(app)
      .post('/api/tasks/nonexistent/rollback')
      .set('X-Gateway-Key', SECRET);
    expect(res.status).toBe(404);
  });
});
