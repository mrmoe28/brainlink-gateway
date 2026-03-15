import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rmSync } from 'node:fs';
import { TaskStore } from '../../src/approval/queue.js';
import type { TaskRequest } from '../../src/types/task.js';

const TEST_DIR = 'test/tmp-task-store';

describe('TaskStore', () => {
  let store: TaskStore;
  const request: TaskRequest = {
    type: 'fix',
    repo: 'test-repo',
    description: 'Fix a bug',
    priority: 'normal',
  };

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    store = new TaskStore(TEST_DIR);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('creates and retrieves a task', () => {
    const state = store.create('task_001', request, '/tmp/wt', 'brainlink/task_001/fix-bug');
    expect(state.taskId).toBe('task_001');
    expect(state.status).toBe('pending');

    const retrieved = store.get('task_001');
    expect(retrieved).toBeTruthy();
    expect(retrieved!.repo).toBe('test-repo');
  });

  it('returns null for missing task', () => {
    expect(store.get('nonexistent')).toBeNull();
  });

  it('allows valid state transitions', () => {
    store.create('task_002', request, '/tmp/wt', 'brainlink/task_002/fix');
    const s1 = store.transition('task_002', 'investigating');
    expect(s1.status).toBe('investigating');

    const s2 = store.transition('task_002', 'synthesizing');
    expect(s2.status).toBe('synthesizing');
  });

  it('rejects invalid state transitions', () => {
    store.create('task_003', request, '/tmp/wt', 'brainlink/task_003/fix');
    expect(() => store.transition('task_003', 'completed')).toThrow('Invalid transition');
    expect(() => store.transition('task_003', 'applying')).toThrow('Invalid transition');
  });

  it('lists tasks by status', () => {
    store.create('task_a', request, '/tmp/wt', 'brainlink/task_a/fix');
    store.create('task_b', request, '/tmp/wt', 'brainlink/task_b/fix');
    store.transition('task_a', 'investigating');
    store.transition('task_a', 'synthesizing');
    store.transition('task_a', 'awaiting_approval');

    const pending = store.listPending();
    expect(pending.length).toBe(1);
    expect(pending[0].taskId).toBe('task_a');
  });

  it('persists across store instances', () => {
    store.create('task_persist', request, '/tmp/wt', 'brainlink/task_persist/fix');

    const store2 = new TaskStore(TEST_DIR);
    const retrieved = store2.get('task_persist');
    expect(retrieved).toBeTruthy();
    expect(retrieved!.taskId).toBe('task_persist');
  });
});
