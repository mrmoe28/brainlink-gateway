import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { generateBranchName } from './branch.js';
import type { AuditLogger } from '../audit/logger.js';

export interface WorktreeInfo {
  taskId: string;
  path: string;
  branch: string;
}

export function createWorktree(
  repoPath: string,
  taskId: string,
  description: string,
  sourceBranch: string,
  audit: AuditLogger,
  maxWorktrees: number = 3,
): WorktreeInfo {
  // Enforce worktree limit
  const active = listWorktrees(repoPath);
  if (active.length >= maxWorktrees) {
    throw new Error(`Worktree limit reached (${maxWorktrees}). Clean up existing worktrees first.`);
  }

  const branch = generateBranchName(taskId, description);
  const worktreeDir = path.join(repoPath, '.worktrees', taskId).replace(/\\/g, '/');

  mkdirSync(path.dirname(worktreeDir), { recursive: true });

  execFileSync('git', ['worktree', 'add', worktreeDir, '-b', branch, sourceBranch], {
    cwd: repoPath,
    encoding: 'utf-8',
    timeout: 30000,
  });

  audit.log(taskId, 'worktree_created', 'gateway', { path: worktreeDir, branch, sourceBranch });

  return { taskId, path: worktreeDir, branch };
}

export function removeWorktree(
  repoPath: string,
  taskId: string,
  branch: string,
  audit: AuditLogger,
): void {
  const worktreeDir = path.join(repoPath, '.worktrees', taskId);

  try {
    if (existsSync(worktreeDir)) {
      execFileSync('git', ['worktree', 'remove', '--force', worktreeDir], {
        cwd: repoPath,
        encoding: 'utf-8',
        timeout: 15000,
      });
    }
  } catch {
    // Force cleanup on Windows file locking
    try {
      rmSync(worktreeDir, { recursive: true, force: true });
      execFileSync('git', ['worktree', 'prune'], { cwd: repoPath, timeout: 10000 });
    } catch { /* best effort */ }
  }

  try {
    execFileSync('git', ['branch', '-D', branch], { cwd: repoPath, encoding: 'utf-8', timeout: 10000 });
  } catch { /* branch may already be deleted */ }

  audit.log(taskId, 'worktree_removed', 'gateway', { path: worktreeDir, branch });
}

export function listWorktrees(repoPath: string): string[] {
  try {
    const output = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 10000,
    });
    return output
      .split('\n')
      .filter(line => line.startsWith('worktree '))
      .map(line => line.replace('worktree ', ''))
      .filter(p => p.includes('.worktrees'));
  } catch {
    return [];
  }
}
