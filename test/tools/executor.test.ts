import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { executeTool, type ExecutorContext } from '../../src/tools/executor.js';
import { AuditLogger } from '../../src/audit/logger.js';

const TEST_DIR = path.resolve('test/tmp-executor-repo');
const LOG_DIR = path.resolve('test/tmp-executor-logs');

let ctx: ExecutorContext;

beforeAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  rmSync(LOG_DIR, { recursive: true, force: true });
  mkdirSync(`${TEST_DIR}/src`, { recursive: true });
  execFileSync('git', ['init'], { cwd: TEST_DIR });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: TEST_DIR });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: TEST_DIR });
  writeFileSync(`${TEST_DIR}/src/index.ts`, 'export const x = 1;\n');
  writeFileSync(`${TEST_DIR}/.env`, 'SECRET=abc');
  execFileSync('git', ['add', '-A'], { cwd: TEST_DIR });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: TEST_DIR });

  ctx = {
    taskId: 'test_task',
    worktreePath: TEST_DIR,
    repoConfig: {
      path: TEST_DIR,
      defaultBranch: 'main',
      allowedCommands: ['npm test', 'echo hello'],
      blockedPaths: ['.env'],
      maxWorktrees: 3,
    },
    audit: new AuditLogger(LOG_DIR),
    actor: 'claude-code',
    readOnly: false,
  };
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  rmSync(LOG_DIR, { recursive: true, force: true });
});

describe('executeTool', () => {
  it('dispatches read_file correctly', async () => {
    const result = await executeTool('read_file', { path: 'src/index.ts' }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain('export');
  });

  it('blocks read of .env via path guard', async () => {
    const result = await executeTool('read_file', { path: '.env' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('denied');
  });

  it('enforces readOnly mode on write_file', async () => {
    const roCtx = { ...ctx, readOnly: true };
    const result = await executeTool('write_file', { path: 'test.txt', content: 'hi' }, roCtx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('read-only');
  });

  it('blocks unapproved commands', async () => {
    const result = await executeTool('run_command', { command: 'curl http://evil.com' }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Blocked');
  });

  it('allows approved commands', async () => {
    const result = await executeTool('run_command', { command: 'echo hello' }, ctx);
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello');
  });

  it('returns error for unknown tool', async () => {
    const result = await executeTool('unknown_tool', {}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown tool');
  });
});
