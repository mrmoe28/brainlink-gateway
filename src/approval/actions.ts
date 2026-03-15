import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { PatchFile } from '../types/task.js';
import type { AuditLogger } from '../audit/logger.js';

export function applyPatch(worktreePath: string, files: PatchFile[]): void {
  for (const file of files) {
    const fullPath = path.resolve(worktreePath, file.path);
    if (file.action === 'delete') {
      try { unlinkSync(fullPath); } catch { /* file may not exist */ }
    } else {
      mkdirSync(path.dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, file.after, 'utf-8');
    }
  }
}

export function commitChanges(
  repoPath: string,
  message: string,
  audit: AuditLogger,
  taskId: string,
): string {
  execFileSync('git', ['add', '-A'], { cwd: repoPath, timeout: 10000 });
  execFileSync('git', ['commit', '-m', message], { cwd: repoPath, timeout: 10000 });
  const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath, encoding: 'utf-8', timeout: 5000 }).trim();
  audit.log(taskId, 'commit_created', 'gateway', { sha, message });
  return sha;
}

export function mergeWorktreeBranch(
  repoPath: string,
  branch: string,
  message: string,
): void {
  // Stash any uncommitted changes before merging
  let stashed = false;
  try {
    const status = execFileSync('git', ['status', '--porcelain'], {
      cwd: repoPath,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim();
    if (status.length > 0) {
      execFileSync('git', ['stash', 'push', '-m', `brainlink-pre-merge-${branch}`], {
        cwd: repoPath,
        timeout: 10000,
      });
      stashed = true;
    }
  } catch { /* no changes to stash */ }

  try {
    execFileSync('git', ['merge', '--no-ff', branch, '-m', message], {
      cwd: repoPath,
      timeout: 30000,
    });
  } finally {
    // Restore stashed changes after merge (even if merge fails)
    if (stashed) {
      try {
        execFileSync('git', ['stash', 'pop'], { cwd: repoPath, timeout: 10000 });
      } catch {
        // Stash pop conflict — leave in stash, user can resolve manually
        console.error(`[Gateway] Stash pop conflict after merge of ${branch}. Run 'git stash pop' manually.`);
      }
    }
  }
}

export function pushBranch(
  repoPath: string,
  branch: string,
  audit: AuditLogger,
  taskId: string,
): void {
  execFileSync('git', ['push', '-u', 'origin', branch], {
    cwd: repoPath,
    encoding: 'utf-8',
    timeout: 60000,
  });
  audit.log(taskId, 'push_executed', 'gateway', { branch });
}

export function openPR(
  repoPath: string,
  title: string,
  body: string,
  audit: AuditLogger,
  taskId: string,
): string {
  const output = execFileSync('gh', ['pr', 'create', '--title', title, '--body', body], {
    cwd: repoPath,
    encoding: 'utf-8',
    timeout: 30000,
  }).trim();
  audit.log(taskId, 'pr_opened', 'gateway', { title, url: output });
  return output;
}

export function rollbackCommit(
  repoPath: string,
  sha: string,
  audit: AuditLogger,
  taskId: string,
): string {
  execFileSync('git', ['revert', '--no-edit', sha], {
    cwd: repoPath,
    timeout: 15000,
  });
  const revertSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoPath,
    encoding: 'utf-8',
    timeout: 5000,
  }).trim();
  audit.log(taskId, 'rollback_completed', 'gateway', { originalSha: sha, revertSha });
  return revertSha;
}
