import type { Patch } from './task.js';

export type WorkerType =
  | 'claude-code'
  | 'reproduce'
  | 'root-cause'
  | 'test-gen'
  | 'review'
  | 'risk';

export interface WorkerResult {
  workerId: string;
  workerType: WorkerType;
  status: 'completed' | 'failed' | 'timed_out';
  model: string;
  result: unknown;
  tokensUsed: number;
  durationMs: number;
  error?: string;
  metadata?: {
    toolsUsed: string[];
    filesRead: string[];
    filesWritten: string[];
    commandsRun: string[];
    focusedFilesTouched: string[];
    toolCallCount: number;
  };
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface WorkerSpec {
  type: WorkerType;
  model: string;
  systemPrompt: string;
  tools: ToolDefinition[];
  context: {
    issue: string;
    repo: string;
    worktreePath: string;
    patch?: Patch;
    focusFiles?: string[];
  };
}

export interface CoworkDispatch {
  taskId: string;
  workers: WorkerSpec[];
  timeout: number;
  failurePolicy: 'continue' | 'abort';
}

export interface ReproduceResult {
  scenario: string;
  triggerConditions: string[];
  expectedBehavior: string;
  actualBehavior: string;
  reproductionSteps: string[];
  minimalExample?: string;
}

export interface RootCauseResult {
  rootCause: string;
  callChain: string[];
  errorType: 'logic' | 'data_handling' | 'race_condition' | 'config' | 'type_error' | 'missing_validation';
  firstBadCommit?: string;
  confidence: number;
}

export interface TestGenResult {
  tests: Array<{
    name: string;
    file: string;
    code: string;
    type: 'unit' | 'integration';
    description: string;
  }>;
}

export interface ReviewResult {
  approved: boolean;
  concerns: Array<{
    severity: 'critical' | 'warning' | 'nit';
    file: string;
    line?: number;
    message: string;
  }>;
  suggestions: string[];
}

export interface RiskResult {
  blastRadius: 'low' | 'medium' | 'high';
  affectedPaths: string[];
  similarIssues: Array<{
    file: string;
    line?: number;
    description: string;
  }>;
  deploymentRisk: string;
  recommendation: string;
}
