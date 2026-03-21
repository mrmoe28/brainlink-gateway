import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { writeFile, mkdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
import { executeCode, saveTool, listTools, runTool, deleteTool } from './runner.js';

const ExecuteSchema = z.object({
  language: z.enum(['python', 'node']),
  code: z.string().min(1).max(100_000),
  timeout: z.number().min(1000).max(120_000).optional(),
});

const SaveToolSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/, 'Name must be lowercase alphanumeric with hyphens/underscores'),
  language: z.enum(['python', 'node']),
  code: z.string().min(1).max(100_000),
  description: z.string().min(1).max(500),
});

const RunToolSchema = z.object({
  args: z.array(z.string()).optional(),
});

export const executeRouter: RouterType = Router();

// Run one-off code
executeRouter.post('/', async (req, res) => {
  try {
    const body = ExecuteSchema.parse(req.body);
    const result = await executeCode(body);

    res.json({
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: err.issues });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Save a persistent tool
executeRouter.post('/tools', async (req, res) => {
  try {
    const body = SaveToolSchema.parse(req.body);
    const meta = await saveTool(body.name, body.language, body.code, body.description);
    res.status(201).json(meta);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: err.issues });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// List all saved tools
executeRouter.get('/tools', async (_req, res) => {
  try {
    const tools = await listTools();
    res.json({ tools });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Run a saved tool by name
executeRouter.post('/tools/:name/run', async (req, res) => {
  try {
    const body = RunToolSchema.parse(req.body);
    const result = await runTool(req.params.name, body.args);
    res.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: err.issues });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Delete a saved tool
executeRouter.delete('/tools/:name', async (req, res) => {
  const deleted = await deleteTool(req.params.name);
  if (!deleted) {
    res.status(404).json({ error: 'Tool not found' });
    return;
  }
  res.json({ deleted: true });
});

// Upload an image (base64) — fast, no subprocess
const UploadSchema = z.object({
  base64: z.string().min(1),
  filename: z.string().min(1).max(200),
});

executeRouter.post('/upload', async (req, res) => {
  try {
    const body = UploadSchema.parse(req.body);
    const byteSize = Math.round(Buffer.byteLength(body.base64, 'base64'));
    if (byteSize > MAX_UPLOAD_BYTES) {
      res.status(413).json({ error: 'Upload exceeds 10 MB limit' });
      return;
    }
    const dir = join(homedir(), 'Downloads', 'brainlink-images');
    await mkdir(dir, { recursive: true });
    const safeFilename = basename(body.filename); // strip any directory components
    const filePath = join(dir, safeFilename);
    await writeFile(filePath, Buffer.from(body.base64, 'base64'));
    res.json({ path: filePath, size: Math.round(byteSize / 1024) });
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ error: 'Validation error', details: err.issues });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});
