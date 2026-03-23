import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { rateLimit } from 'express-rate-limit';
import { loadSettings } from './config/settings.js';
import { loadRepoConfig } from './config/repos.js';
import { authMiddleware } from './security/auth.js';
import { AuditLogger } from './audit/logger.js';
import { TaskStore } from './approval/queue.js';
import { createRouter } from './api/router.js';
import { setupWebSocket, broadcast } from './api/websocket.js';
import { requestId, errorHandler } from './api/middleware.js';
import { startMonitorWorker } from './workers/monitor.js';
import { browseRouter } from './browse/router.js';
import { executeRouter } from './execute/router.js';
import { sshRouter } from './ssh/router.js';
import { hasGithubAuth } from './workspace/repo-source.js';

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
app.use(express.json({ limit: '20mb' }));
app.use(requestId);

// Rate limiting — 120 req/min per IP globally, stricter on task creation
const globalLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const taskLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });
app.use(globalLimiter);

// Serve desktop web UI (public, no auth)
app.use(express.static(path.resolve(import.meta.dirname ?? process.cwd(), '../public')));

// Desktop web UI config — localhost only (never expose via Cloudflare tunnel)
app.get('/api/config', (req, res) => {
  const ip = req.socket.remoteAddress;
  if (ip !== '127.0.0.1' && ip !== '::1' && ip !== '::ffff:127.0.0.1') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  res.json({ gatewayKey: settings.gatewaySecret });
});

// Proxy Claude API calls so desktop UI doesn't need the API key
app.post('/api/chat', async (req, res) => {
  try {
    // Strip any caller-supplied api key to prevent override
    const { 'x-api-key': _stripped, ...safeBody } = req.body ?? {};
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': settings.anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(safeBody),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Synced settings (shared between mobile + desktop)
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const SYNC_FILE = path.resolve(import.meta.dirname ?? process.cwd(), '../data/sync.json');

async function loadSync(): Promise<any> {
  try { return JSON.parse(await readFile(SYNC_FILE, 'utf-8')); }
  catch { return { logins: [], rules: [], settings: {} }; }
}

async function saveSync(data: any): Promise<void> {
  await mkdir(path.dirname(SYNC_FILE), { recursive: true });
  await writeFile(SYNC_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

app.get('/api/sync', async (_req, res) => {
  res.json(await loadSync());
});

const SYNC_ALLOWED_KEYS = new Set(['logins', 'rules', 'settings']);

app.post('/api/sync', express.json({ limit: '100kb' }), async (req, res) => {
  const unknown = Object.keys(req.body ?? {}).filter(k => !SYNC_ALLOWED_KEYS.has(k));
  if (unknown.length > 0) {
    res.status(400).json({ error: `Unknown sync fields: ${unknown.join(', ')}` });
    return;
  }
  const current = await loadSync();
  const updated = { ...current, ...req.body };
  await saveSync(updated);
  res.json(updated);
});

app.patch('/api/sync', express.json({ limit: '100kb' }), async (req, res) => {
  const current = await loadSync();
  if (req.body.logins) current.logins = req.body.logins;
  if (req.body.rules) current.rules = req.body.rules;
  if (req.body.settings) current.settings = { ...current.settings, ...req.body.settings };
  await saveSync(current);
  res.json(current);
});

// Brain (Supabase + Ollama) proxy endpoints
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';
const OLLAMA_URL = process.env.OLLAMA_URL || 'https://ollama.lock28.com';

app.post('/api/brain/search', express.json(), async (req, res) => {
  try {
    const { query } = req.body;
    // Get embedding from Ollama
    const embedRes = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'nomic-embed-text', input: query }),
    });
    const embedData = await embedRes.json() as any;
    const embedding = embedData.embeddings?.[0];
    if (!embedding) { res.json({ results: 'Embedding failed.' }); return; }

    // Search Supabase
    const searchRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_thoughts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({ query_embedding: embedding, match_count: 5, similarity_threshold: 0.3 }),
    });
    const results = await searchRes.json() as any[];
    if (!results || results.length === 0) { res.json({ results: 'No matching thoughts found.' }); return; }
    const text = results.map((r: any) => `[${r.thought_type || 'note'}] ${r.content}`).join('\n');
    res.json({ results: text });
  } catch (err) {
    res.json({ results: 'Brain search error: ' + (err instanceof Error ? err.message : String(err)) });
  }
});

app.post('/api/brain/capture', express.json(), async (req, res) => {
  try {
    const { content, thought_type } = req.body;
    const captureRes = await fetch(`${SUPABASE_URL}/functions/v1/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_KEY}` },
      body: JSON.stringify({ content, thought_type, source: 'brain-link-desktop' }),
    });
    res.json({ ok: captureRes.ok });
  } catch (err) {
    res.json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

// Health endpoint is public
app.get('/api/health', (_req, res) => {
  const allTasks = taskStore.list();
  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    activeWorktrees: allTasks.filter(t => ['investigating', 'synthesizing', 'validating', 'awaiting_approval'].includes(t.status)).length,
    pendingApprovals: allTasks.filter(t => t.status === 'awaiting_approval').length,
    githubAuth: {
      configured: hasGithubAuth(settings),
      defaultOwner: settings.githubDefaultOwner,
    },
  });
});

// Ollama chat proxy — lets the mobile app route through the gateway
// instead of hitting ollama.lock28.com directly (unreachable from mobile networks)
app.post('/api/ollama/chat', async (req, res) => {
  try {
    const ollamaRes = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await ollamaRes.json();
    res.status(ollamaRes.status).json(data);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.get('/api/ollama/models', async (_req, res) => {
  try {
    const tagsRes = await fetch(`${OLLAMA_URL}/api/tags`);
    const data = await tagsRes.json();
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post('/api/ollama/pull', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'model name required' });

  // Respond immediately — model pulls can take minutes and Cloudflare will 524 if we wait
  res.json({ status: 'pulling', model: name, message: 'Pull started in background. Check /api/ollama/models to confirm when ready.' });

  // Fire-and-forget pull in background
  fetch(`${OLLAMA_URL}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, stream: false }),
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    console.log(`[ollama:pull] ${name} → ${(data as any).status || r.status}`);
  }).catch((err) => {
    console.error(`[ollama:pull] ${name} failed:`, err.message);
  });
});

// Protected routes
app.use(authMiddleware(settings.gatewaySecret));
app.post('/api/tasks', taskLimiter);
app.use('/api/browse', browseRouter);
app.use('/api/execute', executeRouter);
app.use('/api/ssh', sshRouter);
app.use(createRouter(taskStore, repoRegistry, audit, broadcast, startTime));

// Error handler (must be last)
app.use(errorHandler);

// HTTP server
const server = createServer(app);

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[ERROR] Port ${settings.port} already in use. Is another instance running?`);
  } else {
    console.error('[ERROR] Server error:', err.message);
  }
  process.exit(1);
});

// WebSocket
setupWebSocket(server, settings.gatewaySecret);
const monitorInterval = startMonitorWorker();

// Ollama keep-alive — ping every 3 minutes to keep the model loaded in VRAM/RAM
// Prevents 90-second cold starts and Cloudflare 524 timeouts
const ollamaKeepAliveInterval = setInterval(async () => {
  try {
    await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'llama3.2:1b-instruct-q4_K_M', prompt: '', keep_alive: '10m' }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // Silent — VPS may be temporarily unreachable
  }
}, 3 * 60 * 1000);

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
        } catch (e) {
          audit.log(task.taskId, 'cleanup_error', 'gateway', { error: String(e) });
        }
      }
    }

    // Check stale worktrees (24h)
    if (['investigating', 'synthesizing', 'validating'].includes(task.status)) {
      const lastUpdate = new Date(task.updatedAt).getTime();
      if (now - lastUpdate > settings.staleWorktreeMs) {
        try {
          taskStore.transition(task.taskId, 'failed');
          audit.log(task.taskId, 'worker_failed', 'gateway', { reason: 'stale' });
        } catch (e) {
          audit.log(task.taskId, 'cleanup_error', 'gateway', { error: String(e) });
        }
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
  } catch (e) {
    console.error(`Failed to recover task ${task.taskId}:`, e);
  }
}

// Start server — exit cleanly on EADDRINUSE so PM2 can restart after port frees
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${settings.port} in use — exiting so PM2 can retry after port is freed.`);
    process.exit(1);
  } else {
    console.error('Server error:', err);
    process.exit(1);
  }
});

server.listen(settings.port, '0.0.0.0', () => {
  console.log(`Brain Link Local Agent Gateway running on port ${settings.port}`);
  console.log(`Repos: ${Object.keys(repoRegistry).join(', ')}`);
  console.log(`GitHub default owner: ${settings.githubDefaultOwner}`);
  console.log(`Dynamic repo cache: ${settings.reposBaseDir}`);
  console.log(`Recovered ${recoveredTasks.length} stale tasks`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down...');
  clearInterval(cleanupInterval);
  clearInterval(ollamaKeepAliveInterval);
  clearInterval(monitorInterval);
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  clearInterval(cleanupInterval);
  clearInterval(ollamaKeepAliveInterval);
  clearInterval(monitorInterval);
  server.close();
  process.exit(0);
});

// Global safety net — prevents silent crashes from unhandled async errors
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err.message, err.stack);
  // Stay alive — log and continue
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled promise rejection:', reason);
  // Stay alive — log and continue
});
