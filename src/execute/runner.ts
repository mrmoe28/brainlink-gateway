import { spawn } from 'node:child_process';
import { writeFile, readFile, unlink, mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

export interface ExecuteRequest {
  language: 'python' | 'node';
  code: string;
  timeout?: number;
}

export interface ExecuteResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 1_048_576; // 1MB

const SCRATCH_DIR = join(tmpdir(), 'brainlink-execute');
const TOOLS_DIR = resolve(import.meta.dirname ?? process.cwd(), '../../data/tools');

const LANGUAGE_CONFIG: Record<string, { command: string; ext: string }> = {
  python: { command: 'python', ext: '.py' },
  node: { command: 'node', ext: '.js' },
};

export async function executeCode(req: ExecuteRequest): Promise<ExecuteResult> {
  const config = LANGUAGE_CONFIG[req.language];
  if (!config) {
    return {
      stdout: '',
      stderr: `Unsupported language: ${req.language}`,
      exitCode: 1,
      durationMs: 0,
      timedOut: false,
    };
  }

  // Ensure scratch dir exists
  await mkdir(SCRATCH_DIR, { recursive: true });

  const fileId = randomUUID();
  const filePath = join(SCRATCH_DIR, `${fileId}${config.ext}`);
  const timeoutMs = Math.min(req.timeout ?? DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

  await writeFile(filePath, req.code, 'utf-8');

  const start = Date.now();

  try {
    return await new Promise<ExecuteResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      let killed = false;

      const proc = spawn(config.command, [filePath], {
        cwd: SCRATCH_DIR,
        timeout: timeoutMs,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
      });

      proc.stdout.on('data', (chunk: Buffer) => {
        if (stdout.length < MAX_OUTPUT_BYTES) {
          stdout += chunk.toString('utf-8');
        }
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < MAX_OUTPUT_BYTES) {
          stderr += chunk.toString('utf-8');
        }
      });

      proc.on('close', (code, signal) => {
        if (signal === 'SIGTERM' || signal === 'SIGKILL') {
          timedOut = true;
        }
        resolve({
          stdout: stdout.slice(0, MAX_OUTPUT_BYTES),
          stderr: stderr.slice(0, MAX_OUTPUT_BYTES),
          exitCode: code,
          durationMs: Date.now() - start,
          timedOut,
        });
      });

      proc.on('error', (err) => {
        resolve({
          stdout: '',
          stderr: err.message,
          exitCode: 1,
          durationMs: Date.now() - start,
          timedOut: false,
        });
      });
    });
  } finally {
    // Clean up temp file
    await unlink(filePath).catch(() => {});
  }
}

// --- Persistent tools ---

export interface ToolMeta {
  name: string;
  language: 'python' | 'node';
  description: string;
  createdAt: string;
  updatedAt: string;
}

interface ToolManifest {
  tools: Record<string, ToolMeta>;
}

async function ensureToolsDir(): Promise<void> {
  await mkdir(TOOLS_DIR, { recursive: true });
}

async function loadManifest(): Promise<ToolManifest> {
  const manifestPath = join(TOOLS_DIR, 'manifest.json');
  try {
    const raw = await readFile(manifestPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { tools: {} };
  }
}

async function saveManifest(manifest: ToolManifest): Promise<void> {
  await writeFile(join(TOOLS_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
}

export async function saveTool(
  name: string,
  language: 'python' | 'node',
  code: string,
  description: string,
): Promise<ToolMeta> {
  await ensureToolsDir();
  const config = LANGUAGE_CONFIG[language];
  const filePath = join(TOOLS_DIR, `${name}${config.ext}`);
  await writeFile(filePath, code, 'utf-8');

  const manifest = await loadManifest();
  const now = new Date().toISOString();
  const meta: ToolMeta = {
    name,
    language,
    description,
    createdAt: manifest.tools[name]?.createdAt ?? now,
    updatedAt: now,
  };
  manifest.tools[name] = meta;
  await saveManifest(manifest);
  return meta;
}

export async function listTools(): Promise<ToolMeta[]> {
  const manifest = await loadManifest();
  return Object.values(manifest.tools);
}

export async function runTool(name: string, args: string[] = []): Promise<ExecuteResult> {
  const manifest = await loadManifest();
  const meta = manifest.tools[name];
  if (!meta) {
    return { stdout: '', stderr: `Tool not found: ${name}`, exitCode: 1, durationMs: 0, timedOut: false };
  }

  const config = LANGUAGE_CONFIG[meta.language];
  const filePath = join(TOOLS_DIR, `${name}${config.ext}`);
  if (!existsSync(filePath)) {
    return { stdout: '', stderr: `Tool file missing: ${name}`, exitCode: 1, durationMs: 0, timedOut: false };
  }

  const start = Date.now();
  return new Promise<ExecuteResult>((resolve) => {
    let stdout = '';
    let stderr = '';

    const proc = spawn(config.command, [filePath, ...args], {
      cwd: TOOLS_DIR,
      timeout: DEFAULT_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
    });

    proc.stdout.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += chunk.toString('utf-8');
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += chunk.toString('utf-8');
    });

    proc.on('close', (code, signal) => {
      resolve({
        stdout: stdout.slice(0, MAX_OUTPUT_BYTES),
        stderr: stderr.slice(0, MAX_OUTPUT_BYTES),
        exitCode: code,
        durationMs: Date.now() - start,
        timedOut: signal === 'SIGTERM' || signal === 'SIGKILL',
      });
    });

    proc.on('error', (err) => {
      resolve({ stdout: '', stderr: err.message, exitCode: 1, durationMs: Date.now() - start, timedOut: false });
    });
  });
}

export async function deleteTool(name: string): Promise<boolean> {
  const manifest = await loadManifest();
  const meta = manifest.tools[name];
  if (!meta) return false;

  const config = LANGUAGE_CONFIG[meta.language];
  await unlink(join(TOOLS_DIR, `${name}${config.ext}`)).catch(() => {});
  delete manifest.tools[name];
  await saveManifest(manifest);
  return true;
}
