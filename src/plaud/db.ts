import { createRequire } from 'node:module';
import { existsSync } from 'fs';
import type Database from 'better-sqlite3';

const _require = createRequire(import.meta.url);

// Load native addon at startup; gracefully handle missing/uncompiled bindings
let DatabaseClass: (typeof Database) | null = null;
try {
  DatabaseClass = _require('better-sqlite3') as typeof Database;
} catch {
  // better-sqlite3 bindings unavailable — all queries return empty results
}

const PLAUD_DB_PATH = process.env.PLAUD_DB_PATH || 'C:\\Users\\Dell\\Desktop\\palud-mcp\\plaud-mcp.db';

let _db: Database.Database | null = null;

function getDb(): Database.Database | null {
  if (!DatabaseClass) return null;
  if (_db) return _db;
  if (!existsSync(PLAUD_DB_PATH)) return null;
  _db = new DatabaseClass(PLAUD_DB_PATH, { readonly: true });
  return _db;
}

export interface PlaudRecording {
  id: number;
  source_type: string;
  source_ref: string;
  title: string | null;
  transcript: string | null;
  summary: string | null;
  duration_seconds: number | null;
  recorded_at: string | null;
  category: string | null;
  subcategory: string | null;
  tags: string | null;
  entities: string | null;
  action_items: string | null;
  key_ideas: string | null;
  enriched_summary: string | null;
  enrichment_status: string;
  created_at: string;
}

function parseJson(val: string | null): string[] {
  if (!val) return [];
  try { return JSON.parse(val); } catch { return []; }
}

function formatRecording(r: PlaudRecording) {
  return {
    id: r.id,
    title: r.title,
    summary: r.enriched_summary || r.summary,
    duration_seconds: r.duration_seconds,
    recorded_at: r.recorded_at,
    category: r.category,
    subcategory: r.subcategory,
    tags: parseJson(r.tags),
    action_items: parseJson(r.action_items),
    key_ideas: parseJson(r.key_ideas),
    enrichment_status: r.enrichment_status,
    created_at: r.created_at,
  };
}

export function listRecordings(offset = 0, limit = 10) {
  const db = getDb();
  if (!db) return { total: 0, offset, limit, items: [], unavailable: true };
  const total = (db.prepare('SELECT COUNT(*) as c FROM recordings').get() as { c: number }).c;
  const items = db
    .prepare('SELECT * FROM recordings ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as PlaudRecording[];
  return { total, offset, limit, items: items.map(formatRecording) };
}

export function searchRecordings(query: string, limit = 10) {
  const db = getDb();
  if (!db) return { query, count: 0, items: [], unavailable: true };
  const pattern = `%${query}%`;
  const items = db
    .prepare(
      `SELECT * FROM recordings
       WHERE transcript LIKE ? OR summary LIKE ? OR title LIKE ?
         OR enriched_summary LIKE ? OR tags LIKE ? OR entities LIKE ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(pattern, pattern, pattern, pattern, pattern, pattern, limit) as PlaudRecording[];
  return { query, count: items.length, items: items.map(formatRecording) };
}

export function getRecordingWithTranscript(id: number) {
  const db = getDb();
  if (!db) return null;
  const r = db.prepare('SELECT * FROM recordings WHERE id = ?').get(id) as PlaudRecording | undefined;
  if (!r) return null;
  return {
    ...formatRecording(r),
    transcript: r.transcript,
  };
}

export function getAllActionItems() {
  const db = getDb();
  if (!db) return [];
  const rows = db
    .prepare(
      `SELECT id, title, category, action_items, recorded_at FROM recordings
       WHERE action_items IS NOT NULL AND action_items != '[]'
       ORDER BY created_at DESC`
    )
    .all() as { id: number; title: string | null; category: string | null; action_items: string; recorded_at: string | null }[];
  return rows.map(r => ({
    recording_id: r.id,
    title: r.title,
    category: r.category,
    recorded_at: r.recorded_at,
    action_items: parseJson(r.action_items),
  }));
}
