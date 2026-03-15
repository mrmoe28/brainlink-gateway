import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { readFileTool, listDirectoryTool, searchContentTool } from '../../src/tools/file-ops.js';

const TEST_DIR = 'test/tmp-repo';

beforeAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(`${TEST_DIR}/src`, { recursive: true });
  writeFileSync(`${TEST_DIR}/src/index.ts`, 'export function hello() {\n  return "world";\n}\n');
  writeFileSync(`${TEST_DIR}/src/utils.ts`, 'export const PI = 3.14;\nexport function add(a: number, b: number) { return a + b; }\n');
  writeFileSync(`${TEST_DIR}/package.json`, '{"name":"test"}');
});

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('readFileTool', () => {
  it('reads a file with line numbers', async () => {
    const result = await readFileTool(TEST_DIR, 'src/index.ts');
    expect(result.success).toBe(true);
    expect(result.output).toContain('1\t');
    expect(result.output).toContain('hello');
  });

  it('supports start_line and end_line', async () => {
    const result = await readFileTool(TEST_DIR, 'src/index.ts', 2, 2);
    expect(result.output).toContain('return');
  });

  it('returns error for missing file', async () => {
    const result = await readFileTool(TEST_DIR, 'nonexistent.ts');
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('listDirectoryTool', () => {
  it('lists files in directory', async () => {
    const result = await listDirectoryTool(TEST_DIR, '.');
    expect(result.success).toBe(true);
    expect(result.output).toContain('src');
    expect(result.output).toContain('package.json');
  });
});

describe('searchContentTool', () => {
  it('finds matching content', async () => {
    const result = await searchContentTool(TEST_DIR, 'hello');
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello');
  });

  it('returns no matches message', async () => {
    const result = await searchContentTool(TEST_DIR, 'zzz_nonexistent_pattern_xyz');
    expect(result.success).toBe(true);
    expect(result.output).toContain('No matches');
  });
});
