import { broadcastToAll } from '../api/websocket.js';

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
    const deadlineMs = Date.parse(p.deadline);
    if (isNaN(deadlineMs)) continue;
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
    if (t.status !== 'blocked') continue;
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

async function fetchActiveProjects(): Promise<ProjectRow[]> {
  const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
  const SUPABASE_KEY = process.env.SUPABASE_KEY ?? '';
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_projects?select=id,title,status,deadline&status=eq.active`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    if (!res.ok) return [];
    return res.json() as Promise<ProjectRow[]>;
  } catch {
    return [];
  }
}

async function fetchBlockedTasks(): Promise<TaskRow[]> {
  const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
  const SUPABASE_KEY = process.env.SUPABASE_KEY ?? '';
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/agent_tasks?select=id,project_id,title,status&status=eq.blocked`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    if (!res.ok) return [];
    return res.json() as Promise<TaskRow[]>;
  } catch {
    return [];
  }
}

async function runMonitorCycle(): Promise<void> {
  try {
    const [projects, tasks] = await Promise.all([fetchActiveProjects(), fetchBlockedTasks()]);
    const alerts = compileAlerts(projects, tasks);
    if (alerts.length > 0) {
      broadcastToAll({ type: 'proactive_alert', alerts });
    }
  } catch (err) {
    console.error('[monitor] cycle error:', err instanceof Error ? err.message : String(err));
  }
}

export function startMonitorWorker(intervalMs = 15 * 60 * 1000): NodeJS.Timeout {
  void runMonitorCycle(); // run immediately on startup
  return setInterval(runMonitorCycle, intervalMs);
}
