import { z } from 'zod';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const RepoSchema = z.object({
  path: z.string().min(1),
  defaultBranch: z.string().min(1),
  allowedCommands: z.array(z.string()),
  blockedPaths: z.array(z.string()),
  maxWorktrees: z.number().int().positive(),
});

const RepoConfigSchema = z.record(z.string(), RepoSchema);

export type RepoConfig = z.infer<typeof RepoSchema>;
export type RepoRegistry = z.infer<typeof RepoConfigSchema>;

export function loadRepoConfig(configPath: string): RepoRegistry {
  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch {
    throw new Error(`Failed to read repo config: ${configPath}`);
  }
  const parsed = JSON.parse(raw);
  return RepoConfigSchema.parse(parsed);
}

export function getRepoConfig(registry: RepoRegistry, repoKey: string): RepoConfig {
  const repo = registry[repoKey];
  if (!repo) {
    throw new Error(`Unknown repo: ${repoKey}. Available: ${Object.keys(registry).join(', ')}`);
  }
  return repo;
}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}
