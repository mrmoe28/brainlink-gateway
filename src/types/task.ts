export type TaskStatus =
  | 'pending'
  | 'investigating'
  | 'synthesizing'
  | 'validating'
  | 'awaiting_approval'
  | 'applying'
  | 'completed'
  | 'failed'
  | 'rolled_back'
  | 'rejected'
  | 'expired';

export interface TaskRequest {
  type: 'diagnose' | 'fix' | 'investigate' | 'test' | 'review';
  repo: string;
  description: string;
  files?: string[];
  branch?: string;
  priority: 'normal' | 'urgent';
}

export interface Diagnosis {
  summary: string;
  rootCause: string;
  affectedFiles: string[];
  confidence: number;
  evidence: string[];
}

export interface PatchFile {
  path: string;
  action: 'modify' | 'create' | 'delete';
  diff: string;
  before?: string;
  after: string;
}

export interface Patch {
  files: PatchFile[];
  description: string;
  diffStat: {
    additions: number;
    deletions: number;
    filesChanged: number;
  };
}

export interface DiffConcern {
  severity: 'critical' | 'warning' | 'nit';
  file: string;
  line?: number;
  message: string;
}

export interface ValidationResult {
  tests: {
    command: string;
    passed: number;
    failed: number;
    skipped: number;
    output: string;
    durationMs: number;
  } | null;
  lint: {
    command: string;
    errors: number;
    warnings: number;
    output: string;
    durationMs: number;
  } | null;
  build: {
    command: string;
    success: boolean;
    output: string;
    durationMs: number;
  } | null;
  typecheck: {
    command: string;
    success: boolean;
    output: string;
    durationMs: number;
  } | null;
  diffReview: {
    approved: boolean;
    concerns: DiffConcern[];
    suggestions: string[];
  } | null;
  overallPass: boolean;
}

export interface ApprovalAction {
  id: string;
  label: string;
  description: string;
}

export interface ApprovalRecord {
  required: boolean;
  availableActions: ApprovalAction[];
  requestedAt: string;
  expiresAt: string;
  decidedAt?: string;
  decision?: 'approved' | 'rejected';
  chosenAction?: string;
  commitSha?: string;
  prUrl?: string;
}

export interface Synthesis {
  summary: string;
  rootCause: string;
  confidence: number;
  agreementScore: number;
  conflicts: string[];
  recommendation: 'proceed' | 'needs_review' | 'insufficient_data';
  additionalIssues: string[];
}

export type AuditAction =
  | 'task_created'
  | 'worktree_created'
  | 'worktree_removed'
  | 'file_read'
  | 'file_written'
  | 'directory_listed'
  | 'content_searched'
  | 'command_executed'
  | 'command_blocked'
  | 'path_blocked'
  | 'worker_started'
  | 'worker_completed'
  | 'worker_failed'
  | 'worker_timed_out'
  | 'patch_generated'
  | 'patch_applied'
  | 'validation_started'
  | 'validation_completed'
  | 'approval_requested'
  | 'approval_granted'
  | 'approval_rejected'
  | 'approval_expired'
  | 'commit_created'
  | 'push_executed'
  | 'pr_opened'
  | 'rollback_triggered'
  | 'rollback_completed';

export interface AuditEntry {
  timestamp: string;
  taskId: string;
  action: AuditAction;
  actor: 'gateway' | 'claude-code' | 'cowork-worker' | 'user';
  details: Record<string, unknown>;
}

export interface TaskState {
  taskId: string;
  status: TaskStatus;
  repo: string;
  worktreePath: string;
  worktreeBranch: string;
  createdAt: string;
  updatedAt: string;
  diagnosis?: Diagnosis;
  patch?: Patch;
  workerResults: import('./worker.js').WorkerResult[];
  synthesis?: Synthesis;
  validation?: ValidationResult;
  approval?: ApprovalRecord;
  auditTrail: AuditEntry[];
}
