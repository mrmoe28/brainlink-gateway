import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export interface ValidationConfig {
  test: string | null;
  lint: string | null;
  build: string | null;
  typecheck: string | null;
}

const ESLINT_CONFIGS = ['.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yml', 'eslint.config.js', 'eslint.config.mjs'];

export function detectValidation(worktreePath: string): ValidationConfig {
  let pkg: any = {};
  try {
    pkg = JSON.parse(readFileSync(path.join(worktreePath, 'package.json'), 'utf-8'));
  } catch {
    return { test: null, lint: null, build: null, typecheck: null };
  }

  const hasEslint = ESLINT_CONFIGS.some(f => existsSync(path.join(worktreePath, f)));

  return {
    test: pkg.scripts?.test ? 'npm test' : null,
    lint: pkg.scripts?.lint
      ? 'npm run lint'
      : hasEslint ? 'npx eslint . --ext .ts,.tsx' : null,
    build: pkg.scripts?.build ? 'npm run build' : null,
    typecheck: pkg.scripts?.typecheck
      ? 'npm run typecheck'
      : existsSync(path.join(worktreePath, 'tsconfig.json')) ? 'npx tsc --noEmit' : null,
  };
}
