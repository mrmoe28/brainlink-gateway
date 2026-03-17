import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import type { RepoConfig, RepoRegistry } from '../config/repos.js';
import type { Settings } from '../config/settings.js';

export interface ResolvedRepoSource {
  repoKey: string;
  repoFullName: string;
  repoUrl: string;
  repoConfig: RepoConfig;
  cloned: boolean;
}

interface RequestedRepoSource {
  repo: string;
  repoUrl?: string;
  branch?: string;
}

function normalizeRepoUrl(repoUrl: string): string {
  if (repoUrl.startsWith('git@github.com:')) {
    return `https://github.com/${repoUrl.slice('git@github.com:'.length).replace(/\.git$/, '')}`;
  }
  return repoUrl.replace(/\.git$/, '');
}

function sanitizeRepoKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9/_-]+/g, '-').replace(/^\/+|\/+$/g, '');
}

function parseRepoSource(input: RequestedRepoSource, settings: Settings): { repoKey: string; repoFullName: string; repoUrl: string } {
  if (input.repoUrl) {
    const normalizedUrl = normalizeRepoUrl(input.repoUrl.trim());
    const match = normalizedUrl.match(/github\.com[/:]([^/]+\/[^/]+)$/i);
    if (!match) {
      throw new Error(`Unsupported repo URL: ${input.repoUrl}`);
    }
    const repoFullName = match[1];
    return {
      repoKey: sanitizeRepoKey(input.repo),
      repoFullName,
      repoUrl: `https://github.com/${repoFullName}`,
    };
  }

  const repo = input.repo.trim().replace(/\.git$/, '');
  if (repo.includes('/')) {
    return {
      repoKey: sanitizeRepoKey(repo.split('/').pop() || repo),
      repoFullName: repo,
      repoUrl: `https://github.com/${repo}`,
    };
  }

  const repoFullName = `${settings.githubDefaultOwner}/${repo}`;
  return {
    repoKey: sanitizeRepoKey(repo),
    repoFullName,
    repoUrl: `https://github.com/${repoFullName}`,
  };
}

function getRepoClonePath(baseDir: string, repoFullName: string): string {
  return path.resolve(baseDir, repoFullName.replace(/[\\/]/g, '__'));
}

export function ensureGithubAuth(settings: Settings): void {
  if (settings.githubToken) return;

  try {
    execFileSync('gh', ['auth', 'status'], {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: 'ignore',
    });
  } catch {
    throw new Error('GitHub auth is not configured on the gateway. Set GITHUB_TOKEN or run gh auth login.');
  }
}

export function hasGithubAuth(settings: Settings): boolean {
  if (settings.githubToken) return true;
  try {
    execFileSync('gh', ['auth', 'status'], {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function buildGitEnv(settings: Settings): NodeJS.ProcessEnv {
  if (!settings.githubToken) return process.env;
  return {
    ...process.env,
    GITHUB_TOKEN: settings.githubToken,
    GH_TOKEN: settings.githubToken,
  };
}

function runGitCommand(args: string[], cwd: string | undefined, settings: Settings): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    timeout: 120000,
    env: buildGitEnv(settings),
  }).trim();
}

function cloneRepo(repoUrl: string, repoPath: string, settings: Settings): void {
  mkdirSync(path.dirname(repoPath), { recursive: true });

  if (settings.githubToken) {
    const authenticatedUrl = repoUrl.replace('https://', `https://x-access-token:${settings.githubToken}@`);
    runGitCommand(['clone', authenticatedUrl, repoPath], undefined, settings);
    runGitCommand(['remote', 'set-url', 'origin', repoUrl], repoPath, settings);
    return;
  }

  execFileSync('gh', ['repo', 'clone', repoUrl.replace('https://github.com/', ''), repoPath], {
    encoding: 'utf-8',
    timeout: 120000,
    env: buildGitEnv(settings),
  });
}

function updateRepo(repoPath: string, branch: string, settings: Settings): void {
  runGitCommand(['fetch', '--all', '--prune'], repoPath, settings);
  runGitCommand(['checkout', branch], repoPath, settings);
  runGitCommand(['pull', '--ff-only', 'origin', branch], repoPath, settings);
}

function detectDefaultBranch(repoPath: string, settings: Settings): string {
  try {
    const ref = runGitCommand(['symbolic-ref', 'refs/remotes/origin/HEAD'], repoPath, settings);
    const match = ref.match(/refs\/remotes\/origin\/(.+)$/);
    if (match?.[1]) return match[1];
  } catch {
    // ignore
  }
  return 'master';
}

export function resolveRepoSource(
  registry: RepoRegistry,
  input: RequestedRepoSource,
  settings: Settings,
): ResolvedRepoSource {
  const existing = registry[input.repo];
  if (existing) {
    return {
      repoKey: input.repo,
      repoFullName: `${settings.githubDefaultOwner}/${input.repo}`,
      repoUrl: `https://github.com/${settings.githubDefaultOwner}/${input.repo}`,
      repoConfig: existing,
      cloned: false,
    };
  }

  ensureGithubAuth(settings);

  const parsed = parseRepoSource(input, settings);
  const repoPath = getRepoClonePath(settings.reposBaseDir, parsed.repoFullName);
  const cloned = !existsSync(repoPath);
  if (cloned) {
    cloneRepo(parsed.repoUrl, repoPath, settings);
  }

  let resolvedBranch = input.branch || detectDefaultBranch(repoPath, settings);

  try {
    updateRepo(repoPath, resolvedBranch, settings);
  } catch {
    const fallbackBranch = resolvedBranch === 'main' ? 'master' : 'main';
    updateRepo(repoPath, fallbackBranch, settings);
    resolvedBranch = fallbackBranch;
  }

  return {
    repoKey: parsed.repoKey,
    repoFullName: parsed.repoFullName,
    repoUrl: parsed.repoUrl,
    repoConfig: {
      path: repoPath.replace(/\\/g, '/'),
      defaultBranch: resolvedBranch,
      allowedCommands: ['npm test', 'npm run lint', 'npm run build', 'npm run typecheck', 'npx tsc --noEmit', 'pnpm test', 'pnpm lint', 'pnpm build'],
      blockedPaths: ['.env', '.env.local', '*.pem', '*.key'],
      maxWorktrees: 3,
    },
    cloned,
  };
}
