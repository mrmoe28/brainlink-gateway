export interface CreateTaskResponse {
  taskId: string;
  status: string;
  worktreeBranch: string;
  createdAt: string;
}

export interface ApproveRequest {
  action: 'apply_and_commit' | 'apply_commit_and_pr' | 'reject';
  commitMessage?: string;
}

export interface HealthResponse {
  status: 'ok';
  uptime: number;
  activeWorktrees: number;
  pendingApprovals: number;
}

export interface WSMessage {
  type: string;
  taskId?: string;
  [key: string]: unknown;
}
