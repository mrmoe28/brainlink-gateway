import { exec as execCb } from 'node:child_process';
import type { ToolResult } from '../types/tools.js';

const DEFAULT_TIMEOUT = 30000;
const MAX_TIMEOUT = 120000;
const MAX_OUTPUT = 8000;

export async function execCommandTool(
  command: string,
  cwd: string,
  timeoutMs: number = DEFAULT_TIMEOUT,
): Promise<ToolResult> {
  const timeout = Math.min(timeoutMs, MAX_TIMEOUT);

  return new Promise((resolve) => {
    const child = execCb(
      command,
      { cwd, timeout, encoding: 'utf-8', maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        const output = (stdout + (stderr ? '\nSTDERR:\n' + stderr : '')).trim();
        const truncated = output.length > MAX_OUTPUT
          ? output.slice(0, MAX_OUTPUT) + '\n[truncated]'
          : output;

        if (error) {
          if (error.killed) {
            resolve({ success: false, output: truncated, error: `Command timed out after ${timeout}ms` });
          } else {
            resolve({ success: false, output: truncated, error: `Exit code ${(error as any).code}: ${error.message}` });
          }
        } else {
          resolve({ success: true, output: truncated });
        }
      },
    );
  });
}
