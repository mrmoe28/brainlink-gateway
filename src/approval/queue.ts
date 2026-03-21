import { readFileSync, writeFileSync, renameSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { TaskState, TaskStatus, TaskRequest } from '../types/task.js';

const DATA_DIR = 'data/tasks';

// Valid state transitions
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ['investigating', 'failed'],
  investigating: ['synthesizing', 'failed'],
  synthesizing: ['validating', 'awaiting_approval', 'failed'],
  validating: ['awaiting_approval', 'failed'],
  awaiting_approval: ['applying', 'rejected', 'expired', 'failed'],
  applying: ['completed', 'failed'],
  completed: ['rolled_back'],
  failed: ['rolled_back'],
  rolled_back: [],
  rejected: [],
  expired: ['applying', 'rejected'], // can resume expired tasks
};

export class TaskStore {
  private dataDir: string;

  constructor(dataDir: string = DATA_DIR) {
    this.dataDir = dataDir;
    mkdirSync(this.dataDir, { recursive: true });
  }

  create(
    taskId: string,
    request: TaskRequest,
    worktreePath: string,
    worktreeBranch: string,
  ): TaskState {
    const now = new Date().toISOString();
    const state: TaskState = {
      taskId,
      status: 'pending',
      repo: request.repo,
      repoUrl: request.repoUrl,
      worktreePath,
      worktreeBranch,
      createdAt: now,
      updatedAt: now,
      workerResults: [],
      auditTrail: [],
    };
    this.persist(state);
    return state;
  }

  get(taskId: string): TaskState | null {
    const filePath = path.join(this.dataDir, `${taskId}.json`);
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  }

  update(taskId: string, updates: Partial<TaskState>): TaskState {
    const state = this.get(taskId);
    if (!state) throw new Error(`Task not found: ${taskId}`);
    const updated = { ...state, ...updates, updatedAt: new Date().toISOString() };
    this.persist(updated);
    return updated;
  }

  transition(taskId: string, newStatus: TaskStatus): TaskState {
    const state = this.get(taskId);
    if (!state) throw new Error(`Task not found: ${taskId}`);

    const allowed = VALID_TRANSITIONS[state.status];
    if (!allowed || !allowed.includes(newStatus)) {
      throw new Error(`Invalid transition: ${state.status} -> ${newStatus}`);
    }

    return this.update(taskId, { status: newStatus });
  }

  list(): TaskState[] {
    if (!existsSync(this.dataDir)) return [];
    return readdirSync(this.dataDir)
      .filter(f => f.endsWith('.json'))
      .map(f => JSON.parse(readFileSync(path.join(this.dataDir, f), 'utf-8')));
  }

  listByStatus(status: TaskStatus): TaskState[] {
    return this.list().filter(t => t.status === status);
  }

  listPending(): TaskState[] {
    return this.listByStatus('awaiting_approval');
  }

  private persist(state: TaskState): void {
    const filePath = path.join(this.dataDir, `${state.taskId}.json`);
    const tmpPath = filePath + '.tmp';
    writeFileSync(tmpPath, JSON.stringify(state, null, 2));
    renameSync(tmpPath, filePath);
  }
}
