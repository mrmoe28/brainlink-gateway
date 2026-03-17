import { existsSync } from 'node:fs';
import path from 'node:path';
import { detectValidation } from './detector.js';
import { execCommandTool } from '../tools/shell-ops.js';
import type { ValidationResult } from '../types/task.js';
import type { RepoConfig } from '../config/repos.js';
import type { AuditLogger } from '../audit/logger.js';
import { validateCommand } from '../security/command-guard.js';

export async function runValidation(
  worktreePath: string,
  repoConfig: RepoConfig,
  audit: AuditLogger,
  taskId: string,
  patchModifiedPackageJson: boolean = false,
  acceptanceCommands: string[] = [],
): Promise<ValidationResult> {
  audit.log(taskId, 'validation_started', 'gateway', { worktreePath });

  // Install dependencies if needed
  const hasNodeModules = existsSync(path.join(worktreePath, 'node_modules'));
  if (!hasNodeModules || patchModifiedPackageJson) {
    const installCmd = existsSync(path.join(worktreePath, 'pnpm-lock.yaml')) ? 'pnpm install' : 'npm install';
    await execCommandTool(installCmd, worktreePath, 120000);
  }

  const config = detectValidation(worktreePath);
  const result: ValidationResult = {
    tests: null,
    lint: null,
    build: null,
    typecheck: null,
    diffReview: null,
    acceptanceChecks: [],
    overallPass: true,
  };

  // Typecheck
  if (config.typecheck) {
    const r = await execCommandTool(config.typecheck, worktreePath, 60000);
    result.typecheck = {
      command: config.typecheck,
      success: r.success,
      output: r.output.slice(-3000),
      durationMs: 0,
    };
    if (!r.success) result.overallPass = false;
  }

  // Lint
  if (config.lint) {
    const r = await execCommandTool(config.lint, worktreePath, 60000);
    const errors = (r.output.match(/\d+ error/)?.[0] ?? '0 error').replace(' error', '');
    const warnings = (r.output.match(/\d+ warning/)?.[0] ?? '0 warning').replace(' warning', '');
    result.lint = {
      command: config.lint,
      errors: parseInt(errors) || 0,
      warnings: parseInt(warnings) || 0,
      output: r.output.slice(-3000),
      durationMs: 0,
    };
    if (result.lint.errors > 0) result.overallPass = false;
  }

  // Test
  if (config.test) {
    const r = await execCommandTool(config.test, worktreePath, 120000);
    const passMatch = r.output.match(/(\d+) pass/i);
    const failMatch = r.output.match(/(\d+) fail/i);
    const skipMatch = r.output.match(/(\d+) skip/i);
    result.tests = {
      command: config.test,
      passed: passMatch ? parseInt(passMatch[1]) : (r.success ? 1 : 0),
      failed: failMatch ? parseInt(failMatch[1]) : (r.success ? 0 : 1),
      skipped: skipMatch ? parseInt(skipMatch[1]) : 0,
      output: r.output.slice(-3000),
      durationMs: 0,
    };
    if (!r.success) result.overallPass = false;
  }

  // Build
  if (config.build) {
    const r = await execCommandTool(config.build, worktreePath, 120000);
    result.build = {
      command: config.build,
      success: r.success,
      output: r.output.slice(-3000),
      durationMs: 0,
    };
    if (!r.success) result.overallPass = false;
  }

  for (const command of acceptanceCommands) {
    try {
      validateCommand(command, repoConfig.allowedCommands);
      const r = await execCommandTool(command, worktreePath, 120000);
      result.acceptanceChecks.push({
        command,
        success: r.success,
        output: r.output.slice(-3000),
      });
      if (!r.success) result.overallPass = false;
    } catch (err) {
      result.acceptanceChecks.push({
        command,
        success: false,
        output: err instanceof Error ? err.message : String(err),
      });
      result.overallPass = false;
    }
  }

  audit.log(taskId, 'validation_completed', 'gateway', {
    overallPass: result.overallPass,
    tests: result.tests ? { passed: result.tests.passed, failed: result.tests.failed } : null,
    acceptanceChecks: result.acceptanceChecks.map(check => ({ command: check.command, success: check.success })),
  });

  return result;
}
