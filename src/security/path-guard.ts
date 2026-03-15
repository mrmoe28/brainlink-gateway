import path from 'node:path';
import { minimatch } from 'minimatch';
import type { RepoConfig } from '../config/repos.js';

export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
  }
}

const GLOBAL_BLOCKED_PATTERNS = [
  '.env*',
  '.git/config',
  '*.pem',
  '*.key',
  '*credentials*',
  '*secret*',
];

export function validatePath(
  requestedPath: string,
  repoConfig: RepoConfig,
  worktreePath?: string,
): string {
  const basePath = worktreePath ?? repoConfig.path;
  const normalizedBase = basePath.replace(/\\/g, '/');
  const resolved = path.resolve(basePath, requestedPath).replace(/\\/g, '/');

  // Must be within repo/worktree
  if (!resolved.startsWith(normalizedBase)) {
    throw new SecurityError(`Path traversal blocked: ${requestedPath}`);
  }

  const relativePath = path.relative(basePath, resolved).replace(/\\/g, '/');
  const basename = path.basename(relativePath);

  // Check global blocked patterns against both relative path and basename
  for (const pattern of GLOBAL_BLOCKED_PATTERNS) {
    if (minimatch(relativePath, pattern, { dot: true }) ||
        minimatch(basename, pattern, { dot: true })) {
      throw new SecurityError(`Blocked path (global): ${requestedPath}`);
    }
  }

  // Check repo-specific blocked patterns
  for (const pattern of repoConfig.blockedPaths) {
    if (minimatch(relativePath, pattern, { dot: true }) ||
        minimatch(basename, pattern, { dot: true })) {
      throw new SecurityError(`Blocked path (repo): ${requestedPath}`);
    }
  }

  return resolved;
}
