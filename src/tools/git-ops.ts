import { execFileSync } from 'node:child_process';
import type { ToolResult } from '../types/tools.js';

const MAX_RESULT_CHARS = 8000;

function truncate(text: string): ToolResult {
  if (text.length <= MAX_RESULT_CHARS) return { success: true, output: text };
  return { success: true, output: text.slice(0, MAX_RESULT_CHARS) + '\n[truncated]', truncated: true };
}

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { encoding: 'utf-8', cwd, timeout: 15000 }).trim();
}

export async function gitLogTool(cwd: string, filePath?: string, count: number = 10): Promise<ToolResult> {
  try {
    const args = ['log', '--oneline', '--no-decorate', `-${count}`];
    if (filePath) args.push('--', filePath);
    return truncate(git(args, cwd));
  } catch (err) {
    return { success: false, output: '', error: String(err) };
  }
}

export async function gitDiffTool(cwd: string, ref1?: string, ref2?: string, filePath?: string): Promise<ToolResult> {
  try {
    const args = ['diff'];
    if (ref1) args.push(ref1);
    if (ref2) args.push(ref2);
    if (filePath) args.push('--', filePath);
    const output = git(args, cwd);
    return truncate(output || 'No differences.');
  } catch (err) {
    return { success: false, output: '', error: String(err) };
  }
}

export async function gitBlameTool(cwd: string, filePath: string, startLine?: number, endLine?: number): Promise<ToolResult> {
  try {
    const args = ['blame'];
    if (startLine && endLine) args.push('-L', `${startLine},${endLine}`);
    args.push('--', filePath);
    return truncate(git(args, cwd));
  } catch (err) {
    return { success: false, output: '', error: String(err) };
  }
}

export async function gitStatusTool(cwd: string): Promise<ToolResult> {
  try {
    const output = git(['status', '--short'], cwd);
    return { success: true, output: output || 'Working tree clean.' };
  } catch (err) {
    return { success: false, output: '', error: String(err) };
  }
}
