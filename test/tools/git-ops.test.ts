import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { gitLogTool, gitDiffTool, gitStatusTool, gitBlameTool } from '../../src/tools/git-ops.js';

const TEST_DIR = 'test/tmp-git-repo';

beforeAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  execFileSync('git', ['init'], { cwd: TEST_DIR });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: TEST_DIR });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: TEST_DIR });
  writeFileSync(`${TEST_DIR}/README.md`, '# Test\n');
  execFileSync('git', ['add', '-A'], { cwd: TEST_DIR });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: TEST_DIR });
  writeFileSync(`${TEST_DIR}/src.ts`, 'const x = 1;\n');
  execFileSync('git', ['add', '-A'], { cwd: TEST_DIR });
  execFileSync('git', ['commit', '-m', 'add src'], { cwd: TEST_DIR });
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('gitLogTool', () => {
  it('returns commit history', async () => {
    const result = await gitLogTool(TEST_DIR);
    expect(result.success).toBe(true);
    expect(result.output).toContain('initial');
    expect(result.output).toContain('add src');
  });

  it('limits count', async () => {
    const result = await gitLogTool(TEST_DIR, undefined, 1);
    expect(result.output).toContain('add src');
    expect(result.output).not.toContain('initial');
  });
});

describe('gitDiffTool', () => {
  it('shows diff between refs', async () => {
    const result = await gitDiffTool(TEST_DIR, 'HEAD~1', 'HEAD');
    expect(result.success).toBe(true);
    expect(result.output).toContain('src.ts');
  });
});

describe('gitBlameTool', () => {
  it('shows blame for file', async () => {
    const result = await gitBlameTool(TEST_DIR, 'README.md');
    expect(result.success).toBe(true);
    expect(result.output).toContain('Test');
  });
});

describe('gitStatusTool', () => {
  it('shows clean status', async () => {
    const result = await gitStatusTool(TEST_DIR);
    expect(result.success).toBe(true);
  });
});
