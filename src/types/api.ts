export interface CreateTaskResponse {
  taskId: string;
  status: string;
  worktreeBranch: string;
  createdAt: string;
  repo?: string;
  repoUrl?: string;
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
  githubAuth?: {
    configured: boolean;
    defaultOwner: string;
  };
}

export interface WSMessage {
  type: string;
  taskId?: string;
  [key: string]: unknown;
}
