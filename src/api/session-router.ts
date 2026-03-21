import { Router, Request, Response } from 'express';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import pino from 'pino';

const log = pino({ name: 'session-router' });

const SESSIONS_DIR = path.resolve(process.cwd(), 'data/sessions');

interface SessionEvent {
  toolName: string;
  summary: string;
  input: Record<string, unknown>;
  error: string | null;
  timestamp: string;
}

interface Session {
  id: string;
  cwd: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  lastAssistantMessage?: string;
  eventCount: number;
  events: SessionEvent[];
}

async function ensureDir() {
  await mkdir(SESSIONS_DIR, { recursive: true });
}

async function loadSession(sessionId: string): Promise<Session | null> {
  try {
    const data = await readFile(path.join(SESSIONS_DIR, `${sessionId}.json`), 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function saveSession(session: Session): Promise<void> {
  await ensureDir();
  await writeFile(
    path.join(SESSIONS_DIR, `${session.id}.json`),
    JSON.stringify(session, null, 2),
    'utf-8'
  );
}

export const sessionRouter: Router = Router();

// POST /api/sessions/event — append a tool event to the session
sessionRouter.post('/event', async (req: Request, res: Response) => {
  try {
    const { sessionId, cwd, toolName, summary, input, error, timestamp } = req.body;
    if (!sessionId) { res.status(400).json({ error: 'sessionId required' }); return; }

    await ensureDir();
    let session = await loadSession(sessionId);

    if (!session) {
      session = {
        id: sessionId,
        cwd: cwd || '',
        startedAt: timestamp || new Date().toISOString(),
        updatedAt: timestamp || new Date().toISOString(),
        eventCount: 0,
        events: [],
      };
    }

    session.events.push({ toolName, summary, input, error, timestamp });
    session.eventCount = session.events.length;
    session.updatedAt = timestamp || new Date().toISOString();
    if (cwd) session.cwd = cwd;

    await saveSession(session);
    res.json({ ok: true });
  } catch (err) {
    log.error(err, 'Failed to record session event');
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/sessions/finalize — mark session complete, store summary
sessionRouter.post('/finalize', async (req: Request, res: Response) => {
  try {
    const { sessionId, cwd, lastAssistantMessage, finishedAt } = req.body;
    if (!sessionId) { res.status(400).json({ error: 'sessionId required' }); return; }

    await ensureDir();
    let session = await loadSession(sessionId);

    if (!session) {
      // Session had no interesting tool events — create a minimal record
      session = {
        id: sessionId,
        cwd: cwd || '',
        startedAt: finishedAt || new Date().toISOString(),
        updatedAt: finishedAt || new Date().toISOString(),
        eventCount: 0,
        events: [],
      };
    }

    const ts = finishedAt || new Date().toISOString();
    session.finishedAt = ts;
    session.updatedAt = ts;
    if (lastAssistantMessage) session.lastAssistantMessage = lastAssistantMessage;
    if (cwd) session.cwd = cwd;

    await saveSession(session);
    res.json({ ok: true });
  } catch (err) {
    log.error(err, 'Failed to finalize session');
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/sessions — list recent sessions (most recent first, limit 50)
sessionRouter.get('/', async (_req: Request, res: Response) => {
  try {
    await ensureDir();
    const files = await readdir(SESSIONS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    const sessions: Omit<Session, 'events'>[] = [];
    for (const file of jsonFiles) {
      try {
        const data = await readFile(path.join(SESSIONS_DIR, file), 'utf-8');
        const s: Session = JSON.parse(data);
        // Return metadata without full event list
        sessions.push({
          id: s.id,
          cwd: s.cwd,
          startedAt: s.startedAt,
          updatedAt: s.updatedAt,
          finishedAt: s.finishedAt,
          lastAssistantMessage: s.lastAssistantMessage,
          eventCount: s.eventCount,
        });
      } catch {}
    }

    // Sort by most recent first
    sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    res.json(sessions.slice(0, 50));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/sessions/search?q=... — search session summaries (must be before /:id)
sessionRouter.get('/search', async (req: Request, res: Response) => {
  try {
    const query = String(req.query.q || '').toLowerCase().trim();
    if (!query) { res.json([]); return; }

    await ensureDir();
    const files = await readdir(SESSIONS_DIR);
    const matches: { id: string; cwd: string; updatedAt: string; matchedLines: string[] }[] = [];

    for (const file of files.filter(f => f.endsWith('.json'))) {
      try {
        const data = await readFile(path.join(SESSIONS_DIR, file), 'utf-8');
        const s: Session = JSON.parse(data);

        const matchedLines: string[] = [];

        // Search in cwd
        if (s.cwd.toLowerCase().includes(query)) {
          matchedLines.push(`Project: ${s.cwd}`);
        }

        // Search in last assistant message
        if (s.lastAssistantMessage?.toLowerCase().includes(query)) {
          const idx = s.lastAssistantMessage.toLowerCase().indexOf(query);
          const excerpt = s.lastAssistantMessage.slice(Math.max(0, idx - 40), idx + 80);
          matchedLines.push(`...${excerpt}...`);
        }

        // Search event summaries
        for (const ev of s.events || []) {
          if (ev.summary.toLowerCase().includes(query)) {
            matchedLines.push(ev.summary);
          }
          if (ev.error?.toLowerCase().includes(query)) {
            matchedLines.push(`Error: ${ev.error.slice(0, 100)}`);
          }
        }

        if (matchedLines.length > 0) {
          matches.push({
            id: s.id,
            cwd: s.cwd,
            updatedAt: s.updatedAt,
            matchedLines: matchedLines.slice(0, 5),
          });
        }
      } catch {}
    }

    matches.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    res.json(matches.slice(0, 20));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/sessions/:id — get full session with events (after /search to avoid conflict)
sessionRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const session = await loadSession(String(req.params.id));
    if (!session) { res.status(404).json({ error: 'Session not found' }); return; }
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
