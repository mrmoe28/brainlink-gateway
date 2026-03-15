import type { ToolDefinition } from '../types/worker.js';

export const READ_ONLY_TOOLS: ToolDefinition[] = [
  {
    name: 'read_file',
    description: 'Read file contents from the worktree. Returns line-numbered content.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path from repo root' },
        start_line: { type: 'number', description: 'Start line (optional)' },
        end_line: { type: 'number', description: 'End line (optional)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_directory',
    description: 'List files and directories at a path in the worktree.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path. Use "." for root.' },
        recursive: { type: 'boolean', description: 'Include subdirectories' },
        pattern: { type: 'string', description: 'Glob filter (e.g. "*.ts")' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_content',
    description: 'Search file contents using regex.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern' },
        path: { type: 'string', description: 'Directory to search (default: root)' },
        file_pattern: { type: 'string', description: 'File glob filter' },
        context_lines: { type: 'number', description: 'Context lines (default: 2)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'git_log',
    description: 'Get git commit history.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path for file-specific history' },
        count: { type: 'number', description: 'Number of commits (default: 10)' },
      },
    },
  },
  {
    name: 'git_diff',
    description: 'Get diff between git refs.',
    input_schema: {
      type: 'object',
      properties: {
        ref1: { type: 'string' },
        ref2: { type: 'string' },
        path: { type: 'string' },
      },
    },
  },
  {
    name: 'git_blame',
    description: 'Get git blame for a file.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        start_line: { type: 'number' },
        end_line: { type: 'number' },
      },
      required: ['path'],
    },
  },
];

export const WRITE_TOOLS: ToolDefinition[] = [
  {
    name: 'write_file',
    description: 'Write content to a file in the worktree.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path from repo root' },
        content: { type: 'string', description: 'Complete file content' },
      },
      required: ['path', 'content'],
    },
  },
];

export const COMMAND_TOOL: ToolDefinition = {
  name: 'run_command',
  description: 'Execute an approved shell command in the worktree.',
  input_schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Command to run' },
      timeout_ms: { type: 'number', description: 'Timeout in ms (default: 30000)' },
    },
    required: ['command'],
  },
};

export const CLAUDE_CODE_TOOLS: ToolDefinition[] = [...READ_ONLY_TOOLS, ...WRITE_TOOLS, COMMAND_TOOL];
export const COWORK_READ_TOOLS: ToolDefinition[] = [...READ_ONLY_TOOLS];
