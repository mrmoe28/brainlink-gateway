import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { validatePath, SecurityError } from '../security/path-guard.js';
import { validateCommand, CommandBlockedError } from '../security/command-guard.js';
import { readFileTool, listDirectoryTool, searchContentTool } from './file-ops.js';
import { gitLogTool, gitDiffTool, gitBlameTool, gitStatusTool } from './git-ops.js';
import { execCommandTool } from './shell-ops.js';
import type { RepoConfig } from '../config/repos.js';
import type { ToolResult } from '../types/tools.js';
import type { AuditLogger } from '../audit/logger.js';

export interface ExecutorContext {
  taskId: string;
  worktreePath: string;
  repoConfig: RepoConfig;
  audit: AuditLogger;
  actor: 'claude-code' | 'cowork-worker';
  readOnly: boolean;
}

export async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  ctx: ExecutorContext,
): Promise<ToolResult> {
  const { taskId, worktreePath, repoConfig, audit, actor, readOnly } = ctx;

  try {
    switch (toolName) {
      case 'read_file': {
        const filePath = input.path as string;
        validatePath(filePath, repoConfig, worktreePath);
        const result = await readFileTool(worktreePath, filePath, input.start_line as number | undefined, input.end_line as number | undefined);
        audit.log(taskId, 'file_read', actor, { path: filePath });
        return result;
      }
      case 'list_directory': {
        const dirPath = input.path as string;
        validatePath(dirPath, repoConfig, worktreePath);
        const result = await listDirectoryTool(worktreePath, dirPath, input.recursive as boolean | undefined, input.pattern as string | undefined);
        audit.log(taskId, 'directory_listed', actor, { path: dirPath });
        return result;
      }
      case 'search_content': {
        const result = await searchContentTool(worktreePath, input.pattern as string, input.path as string | undefined, input.file_pattern as string | undefined, input.context_lines as number | undefined);
        audit.log(taskId, 'content_searched', actor, { pattern: input.pattern });
        return result;
      }
      case 'git_log': {
        const result = await gitLogTool(worktreePath, input.path as string | undefined, input.count as number | undefined);
        audit.log(taskId, 'command_executed', actor, { command: 'git log' });
        return result;
      }
      case 'git_diff': {
        const result = await gitDiffTool(worktreePath, input.ref1 as string | undefined, input.ref2 as string | undefined, input.path as string | undefined);
        audit.log(taskId, 'command_executed', actor, { command: 'git diff' });
        return result;
      }
      case 'git_blame': {
        const filePath = input.path as string;
        validatePath(filePath, repoConfig, worktreePath);
        const result = await gitBlameTool(worktreePath, filePath, input.start_line as number | undefined, input.end_line as number | undefined);
        audit.log(taskId, 'command_executed', actor, { command: 'git blame' });
        return result;
      }
      case 'write_file': {
        if (readOnly) {
          return { success: false, output: '', error: 'Write access denied: read-only worker' };
        }
        const filePath = input.path as string;
        validatePath(filePath, repoConfig, worktreePath);
        const fullPath = path.resolve(worktreePath, filePath);
        mkdirSync(path.dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, input.content as string, 'utf-8');
        audit.log(taskId, 'file_written', actor, { path: filePath });
        return { success: true, output: `Written: ${filePath}` };
      }
      case 'run_command': {
        const command = input.command as string;
        validateCommand(command, repoConfig.allowedCommands);
        const result = await execCommandTool(command, worktreePath, input.timeout_ms as number | undefined);
        audit.log(taskId, 'command_executed', actor, { command, success: result.success });
        return result;
      }
      default:
        return { success: false, output: '', error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    if (err instanceof SecurityError) {
      audit.log(taskId, 'path_blocked', actor, { tool: toolName, error: err.message });
      return { success: false, output: '', error: `Access denied: ${err.message}` };
    }
    if (err instanceof CommandBlockedError) {
      audit.log(taskId, 'command_blocked', actor, { tool: toolName, error: err.message });
      return { success: false, output: '', error: `Blocked: ${err.message}` };
    }
    return { success: false, output: '', error: String(err) };
  }
}
