import { describe, it, expect } from 'vitest';
import { validatePath, SecurityError } from '../../src/security/path-guard.js';

const REPO_CONFIG = {
  path: 'C:/Users/Dell/Desktop/test-repo',
  defaultBranch: 'main',
  allowedCommands: [],
  blockedPaths: ['.env', '.env.local', '*.pem'],
  maxWorktrees: 3,
};

describe('validatePath', () => {
  it('allows valid relative paths', () => {
    const result = validatePath('src/index.ts', REPO_CONFIG);
    expect(result).toContain('src');
    expect(result).toContain('index.ts');
  });

  it('blocks path traversal with ..', () => {
    expect(() => validatePath('../../../etc/passwd', REPO_CONFIG)).toThrow(SecurityError);
  });

  it('blocks .env files (exact)', () => {
    expect(() => validatePath('.env', REPO_CONFIG)).toThrow(SecurityError);
  });

  it('blocks .env.local (wildcard)', () => {
    expect(() => validatePath('.env.local', REPO_CONFIG)).toThrow(SecurityError);
  });

  it('blocks .env.production (global .env* pattern)', () => {
    expect(() => validatePath('.env.production', REPO_CONFIG)).toThrow(SecurityError);
  });

  it('blocks .pem files via glob', () => {
    expect(() => validatePath('certs/server.pem', REPO_CONFIG)).toThrow(SecurityError);
  });

  it('blocks .git/config (global pattern)', () => {
    expect(() => validatePath('.git/config', REPO_CONFIG)).toThrow(SecurityError);
  });

  it('blocks .key files (global pattern)', () => {
    expect(() => validatePath('secrets.key', REPO_CONFIG)).toThrow(SecurityError);
  });

  it('blocks credentials files (global pattern)', () => {
    expect(() => validatePath('credentials.json', REPO_CONFIG)).toThrow(SecurityError);
  });

  it('allows normal source files', () => {
    expect(() => validatePath('src/components/App.tsx', REPO_CONFIG)).not.toThrow();
    expect(() => validatePath('package.json', REPO_CONFIG)).not.toThrow();
    expect(() => validatePath('test/utils.test.ts', REPO_CONFIG)).not.toThrow();
    expect(() => validatePath('README.md', REPO_CONFIG)).not.toThrow();
  });

  it('allows with worktree path override', () => {
    const result = validatePath('src/index.ts', REPO_CONFIG, 'C:/Users/Dell/Desktop/test-repo/.worktrees/task_123');
    expect(result).toContain('.worktrees');
    expect(result).toContain('index.ts');
  });
});
