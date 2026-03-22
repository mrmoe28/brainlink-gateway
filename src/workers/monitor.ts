export interface ProactiveAlert {
  id: string;
  kind: 'approaching_deadline' | 'overdue' | 'blocked_task';
  projectId?: string;
  taskId?: string;
  title: string;
  detail: string;
  createdAt: string;
}

interface ProjectRow {
  id: string;
  title: string;
  status: string;
  deadline: string | null;
}

interface TaskRow {
  id: string;
  project_id: string;
  title: string;
  status: string;
}

const DEADLINE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function compileAlerts(projects: ProjectRow[], tasks: TaskRow[]): ProactiveAlert[] {
  const now = Date.now();
  const alerts: ProactiveAlert[] = [];

  for (const p of projects) {
    if (!p.deadline) continue;
    const deadlineMs = new Date(p.deadline).getTime();
    if (deadlineMs < now) {
      alerts.push({
        id: `overdue:${p.id}`,
        kind: 'overdue',
        projectId: p.id,
        title: `Overdue: ${p.title}`,
        detail: `Deadline was ${new Date(p.deadline).toLocaleString()}`,
        createdAt: new Date().toISOString(),
      });
    } else if (deadlineMs - now < DEADLINE_WINDOW_MS) {
      const hoursLeft = Math.round((deadlineMs - now) / 3_600_000);
      alerts.push({
        id: `deadline:${p.id}`,
        kind: 'approaching_deadline',
        projectId: p.id,
        title: `Due soon: ${p.title}`,
        detail: `${hoursLeft}h remaining`,
        createdAt: new Date().toISOString(),
      });
    }
  }

  for (const t of tasks) {
    alerts.push({
      id: `blocked:${t.id}`,
      kind: 'blocked_task',
      projectId: t.project_id,
      taskId: t.id,
      title: `Blocked task: ${t.title}`,
      detail: 'Task is blocked and needs attention',
      createdAt: new Date().toISOString(),
    });
  }

  return alerts;
}
