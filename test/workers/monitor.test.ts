import { describe, it, expect } from 'vitest';
import { compileAlerts } from '../../src/workers/monitor.js';

describe('compileAlerts', () => {
  it('returns approaching_deadline for project due within 24h', () => {
    const soon = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    const alerts = compileAlerts([{ id: 'p1', title: 'Ship it', status: 'active', deadline: soon }], []);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe('approaching_deadline');
    expect(alerts[0].projectId).toBe('p1');
    expect(alerts[0].id).toBe('deadline:p1');
  });

  it('returns overdue for project with past deadline', () => {
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const alerts = compileAlerts([{ id: 'p2', title: 'Late', status: 'active', deadline: past }], []);
    expect(alerts[0].kind).toBe('overdue');
    expect(alerts[0].id).toBe('overdue:p2');
  });

  it('returns blocked_task for blocked tasks', () => {
    const alerts = compileAlerts([], [{ id: 't1', project_id: 'p1', title: 'Deploy', status: 'blocked' }]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].kind).toBe('blocked_task');
    expect(alerts[0].taskId).toBe('t1');
  });

  it('ignores projects without deadlines', () => {
    const alerts = compileAlerts([{ id: 'p3', title: 'Ongoing', status: 'active', deadline: null }], []);
    expect(alerts).toHaveLength(0);
  });

  it('ignores projects due more than 24h away', () => {
    const future = new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString();
    const alerts = compileAlerts([{ id: 'p4', title: 'Later', status: 'active', deadline: future }], []);
    expect(alerts).toHaveLength(0);
  });

  it('handles empty inputs', () => {
    expect(compileAlerts([], [])).toEqual([]);
  });
});
