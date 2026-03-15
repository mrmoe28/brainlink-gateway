import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ToolResult } from '../types/tools.js';

const MAX_READ_LINES = 500;
const MAX_RESULT_CHARS = 8000;

function truncate(text: string): ToolResult {
  if (text.length <= MAX_RESULT_CHARS) {
    return { success: true, output: text };
  }
  return {
    success: true,
    output: text.slice(0, MAX_RESULT_CHARS) + `\n[truncated, showing first ${MAX_RESULT_CHARS} chars]`,
    truncated: true,
  };
}

export async function readFileTool(
  basePath: string,
  filePath: string,
  startLine?: number,
  endLine?: number,
): Promise<ToolResult> {
  try {
    const fullPath = path.resolve(basePath, filePath);
    const content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    const start = (startLine ?? 1) - 1;
    const end = endLine ?? Math.min(lines.length, start + MAX_READ_LINES);
    const slice = lines.slice(start, end);
    const numbered = slice.map((line, i) => `${start + i + 1}\t${line}`).join('\n');

    if (!startLine && lines.length > MAX_READ_LINES) {
      return truncate(numbered + `\n[File has ${lines.length} total lines. Use start_line/end_line to read specific sections.]`);
    }
    return truncate(numbered);
  } catch {
    return { success: false, output: '', error: `File not found: ${filePath}` };
  }
}

export async function listDirectoryTool(
  basePath: string,
  dirPath: string,
  recursive?: boolean,
  pattern?: string,
): Promise<ToolResult> {
  try {
    const fullPath = path.resolve(basePath, dirPath);
    const entries = readdirSync(fullPath, { withFileTypes: true });
    const lines = entries
      .map(e => e.isDirectory() ? `${e.name}/` : e.name)
      .sort();
    return truncate(lines.join('\n'));
  } catch {
    return { success: false, output: '', error: `Directory not found: ${dirPath}` };
  }
}

export async function searchContentTool(
  basePath: string,
  pattern: string,
  searchPath?: string,
  filePattern?: string,
  contextLines: number = 2,
): Promise<ToolResult> {
  try {
    const dir = searchPath ? path.resolve(basePath, searchPath) : basePath;
    const args = ['--no-heading', '-n', '-C', String(contextLines), '--max-count', '20'];
    if (filePattern) {
      args.push('--glob', filePattern);
    }
    args.push(pattern, dir);

    const output = execFileSync('rg', args, {
      encoding: 'utf-8',
      timeout: 10000,
      cwd: basePath,
    });
    return truncate(output.trim());
  } catch (err: any) {
    // rg returns exit code 1 for no matches
    if (err.status === 1) {
      return { success: true, output: 'No matches found.' };
    }
    // rg not found — fallback to simple grep
    try {
      const dir = searchPath ? path.resolve(basePath, searchPath) : basePath;
      const output = execFileSync('grep', ['-rn', '--include=*.ts', '--include=*.tsx', '--include=*.js', '--include=*.json', pattern, dir], {
        encoding: 'utf-8',
        timeout: 10000,
      });
      return truncate(output.trim());
    } catch {
      return { success: true, output: 'No matches found.' };
    }
  }
}
