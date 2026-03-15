import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { generateTaskId, generateSlug, generateBranchName } from '../../src/workspace/branch.js';
import { createWorktree, removeWorktree, listWorktrees } from '../../src/workspace/worktree.js';
import { AuditLogger } from '../../src/audit/logger.js';

const TEST_DIR = path.resolve('test/tmp-wt-repo');
const LOG_DIR = path.resolve('test/tmp-wt-logs');
let audit: AuditLogger;

beforeAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  rmSync(LOG_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  execFileSync('git', ['init'], { cwd: TEST_DIR });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: TEST_DIR });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: TEST_DIR });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: TEST_DIR });
  audit = new AuditLogger(LOG_DIR);
});

afterAll(() => {
  // Clean up worktrees first
  try {
    execFileSync('git', ['worktree', 'prune'], { cwd: TEST_DIR });
  } catch {}
  rmSync(TEST_DIR, { recursive: true, force: true });
  rmSync(LOG_DIR, { recursive: true, force: true });
});

describe('branch naming', () => {
  it('generateTaskId returns task_ prefix', () => {
    const id = generateTaskId();
    expect(id).toMatch(/^task_[a-z0-9]{5}$/);
  });

  it('generateSlug truncates and kebab-cases', () => {
    expect(generateSlug('Fix the stripe webhook handler error')).toBe('fix-the-stripe-webhook');
    expect(generateSlug('A very long description that exceeds the limit', 20)).toHaveLength(20);
  });

  it('generateBranchName formats correctly', () => {
    const branch = generateBranchName('task_abc12', 'Fix webhook error');
    expect(branch).toBe('brainlink/task_abc12/fix-webhook-error');
  });
});

describe('worktree lifecycle', () => {
  const taskId = 'task_test1';

  it('creates a worktree', () => {
    const info = createWorktree(TEST_DIR, taskId, 'test worktree creation', 'master', audit);
    expect(info.taskId).toBe(taskId);
    expect(existsSync(info.path)).toBe(true);
    expect(info.branch).toContain('brainlink/');
  });

  it('lists active worktrees', () => {
    const worktrees = listWorktrees(TEST_DIR);
    expect(worktrees.length).toBeGreaterThanOrEqual(1);
  });

  it('removes a worktree', () => {
    const info = createWorktree(TEST_DIR, 'task_test2', 'to remove', 'master', audit);
    removeWorktree(TEST_DIR, 'task_test2', info.branch, audit);
    expect(existsSync(info.path)).toBe(false);
  });

  it('enforces worktree limit', () => {
    expect(() => {
      createWorktree(TEST_DIR, 'task_over', 'over limit', 'master', audit, 1);
    }).toThrow('Worktree limit reached');
  });
});
