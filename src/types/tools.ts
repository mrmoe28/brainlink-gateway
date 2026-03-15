export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  truncated?: boolean;
}
