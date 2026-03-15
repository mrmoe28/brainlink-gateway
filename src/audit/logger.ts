import { appendFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { AuditAction, AuditEntry } from '../types/task.js';

export class AuditLogger {
  private logDir: string;

  constructor(logDir: string = 'logs') {
    this.logDir = logDir;
    mkdirSync(this.logDir, { recursive: true });
  }

  log(
    taskId: string,
    action: AuditAction,
    actor: AuditEntry['actor'],
    details: Record<string, unknown> = {},
  ): AuditEntry {
    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      taskId,
      action,
      actor,
      details,
    };
    const filename = `audit-${this.today()}.jsonl`;
    const filepath = path.join(this.logDir, filename);
    appendFileSync(filepath, JSON.stringify(entry) + '\n');
    return entry;
  }

  getLogFiles(): string[] {
    try {
      return readdirSync(this.logDir)
        .filter(f => f.startsWith('audit-') && f.endsWith('.jsonl'))
        .map(f => path.join(this.logDir, f))
        .sort();
    } catch {
      return [];
    }
  }

  private today(): string {
    return new Date().toISOString().split('T')[0];
  }
}
