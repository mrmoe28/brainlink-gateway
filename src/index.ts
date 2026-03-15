import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { loadSettings } from './config/settings.js';
import { loadRepoConfig } from './config/repos.js';
import { authMiddleware } from './security/auth.js';
import { AuditLogger } from './audit/logger.js';
import { TaskStore } from './approval/queue.js';
import { createRouter } from './api/router.js';
import { setupWebSocket, broadcast } from './api/websocket.js';
import { requestId, errorHandler } from './api/middleware.js';

// Load env
import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

const startTime = Date.now();

// Load config
const settings = loadSettings();
const configPath = path.resolve(import.meta.dirname ?? process.cwd(), '../config/repos.json');
const repoRegistry = loadRepoConfig(configPath);

// Create services
const audit = new AuditLogger('logs');
const taskStore = new TaskStore('data/tasks');

// Express app
const app = express();
app.use(express.json());
app.use(requestId);

// Health endpoint is public
app.get('/api/health', (_req, res) => {
  const allTasks = taskStore.list();
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    activeWorktrees: allTasks.filter(t => ['investigating', 'synthesizing', 'validating', 'awaiting_approval'].includes(t.status)).length,
    pendingApprovals: allTasks.filter(t => t.status === 'awaiting_approval').length,
  });
});

// Protected routes
app.use(authMiddleware(settings.gatewaySecret));
app.use(createRouter(taskStore, repoRegistry, audit, broadcast, startTime));

// Error handler (must be last)
app.use(errorHandler);

// HTTP server
const server = createServer(app);

// WebSocket
setupWebSocket(server, settings.gatewaySecret);

// Stale cleanup interval (every hour)
const cleanupInterval = setInterval(() => {
  const allTasks = taskStore.list();
  const now = Date.now();

  for (const task of allTasks) {
    // Check approval expiration
    if (task.status === 'awaiting_approval' && task.approval?.expiresAt) {
      if (new Date(task.approval.expiresAt).getTime() < now) {
        try {
          taskStore.transition(task.taskId, 'expired');
          audit.log(task.taskId, 'approval_expired', 'gateway', {});
          broadcast(task.taskId, { type: 'task_expired', taskId: task.taskId });
        } catch {}
      }
    }

    // Check stale worktrees (24h)
    if (['investigating', 'synthesizing', 'validating'].includes(task.status)) {
      const lastUpdate = new Date(task.updatedAt).getTime();
      if (now - lastUpdate > settings.staleWorktreeMs) {
        try {
          taskStore.transition(task.taskId, 'failed');
          audit.log(task.taskId, 'worker_failed', 'gateway', { reason: 'stale' });
        } catch {}
      }
    }
  }
}, 3600000);

// Startup recovery: fail any in-flight tasks from previous crash
const recoveredTasks = taskStore.list().filter(t =>
  ['investigating', 'synthesizing', 'validating'].includes(t.status)
);
for (const task of recoveredTasks) {
  try {
    taskStore.transition(task.taskId, 'failed');
    audit.log(task.taskId, 'worker_failed', 'gateway', { reason: 'gateway_restarted' });
    console.log(`Recovered stale task: ${task.taskId} (was ${task.status})`);
  } catch {}
}

// Start server
server.listen(settings.port, () => {
  console.log(`Brain Link Local Agent Gateway running on port ${settings.port}`);
  console.log(`Repos: ${Object.keys(repoRegistry).join(', ')}`);
  console.log(`Recovered ${recoveredTasks.length} stale tasks`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  clearInterval(cleanupInterval);
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  clearInterval(cleanupInterval);
  server.close();
  process.exit(0);
});
