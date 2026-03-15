import { describe, it, expect } from 'vitest';
import { loadRepoConfig } from '../../src/config/repos.js';
import path from 'node:path';

describe('loadRepoConfig', () => {
  it('loads and validates repos.json', () => {
    const configPath = path.resolve(import.meta.dirname, '../../config/repos.json');
    const config = loadRepoConfig(configPath);
    expect(config).toBeDefined();
    expect(Object.keys(config).length).toBeGreaterThan(0);
  });

  it('each repo has required fields', () => {
    const configPath = path.resolve(import.meta.dirname, '../../config/repos.json');
    const config = loadRepoConfig(configPath);
    for (const [key, repo] of Object.entries(config)) {
      expect(repo.path).toBeTruthy();
      expect(repo.defaultBranch).toBeTruthy();
      expect(Array.isArray(repo.allowedCommands)).toBe(true);
      expect(Array.isArray(repo.blockedPaths)).toBe(true);
      expect(typeof repo.maxWorktrees).toBe('number');
    }
  });

  it('rejects invalid config path', () => {
    expect(() => loadRepoConfig('/nonexistent/path.json')).toThrow();
  });
});
