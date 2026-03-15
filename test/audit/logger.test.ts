import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { AuditLogger } from '../../src/audit/logger.js';

const TEST_LOG_DIR = 'test/tmp-logs';

describe('AuditLogger', () => {
  let logger: AuditLogger;

  beforeEach(() => {
    rmSync(TEST_LOG_DIR, { recursive: true, force: true });
    mkdirSync(TEST_LOG_DIR, { recursive: true });
    logger = new AuditLogger(TEST_LOG_DIR);
  });

  afterEach(() => {
    rmSync(TEST_LOG_DIR, { recursive: true, force: true });
  });

  it('writes structured JSONL entries', () => {
    logger.log('task_123', 'task_created', 'gateway', { repo: 'test' });
    const files = logger.getLogFiles();
    expect(files.length).toBe(1);
    const content = readFileSync(files[0], 'utf-8').trim();
    const entry = JSON.parse(content);
    expect(entry.taskId).toBe('task_123');
    expect(entry.action).toBe('task_created');
    expect(entry.actor).toBe('gateway');
    expect(entry.details.repo).toBe('test');
    expect(entry.timestamp).toBeTruthy();
  });

  it('appends multiple entries to same file', () => {
    logger.log('task_1', 'file_read', 'claude-code', { path: 'a.ts' });
    logger.log('task_1', 'file_read', 'claude-code', { path: 'b.ts' });
    const files = logger.getLogFiles();
    const lines = readFileSync(files[0], 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);
  });

  it('returns correct entry object', () => {
    const entry = logger.log('task_x', 'command_executed', 'cowork-worker', { cmd: 'npm test' });
    expect(entry.taskId).toBe('task_x');
    expect(entry.action).toBe('command_executed');
    expect(entry.actor).toBe('cowork-worker');
  });
});
