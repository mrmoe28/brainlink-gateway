import { describe, it, expect } from 'vitest';
import { validateCommand, CommandBlockedError } from '../../src/security/command-guard.js';

const ALLOWED = ['npm test', 'npm run lint', 'npm run build'];

describe('validateCommand', () => {
  it('allows repo-specific commands', () => {
    expect(() => validateCommand('npm test', ALLOWED)).not.toThrow();
    expect(() => validateCommand('npm run lint', ALLOWED)).not.toThrow();
  });

  it('allows global git read commands', () => {
    expect(() => validateCommand('git status', ALLOWED)).not.toThrow();
    expect(() => validateCommand('git log --oneline -10', ALLOWED)).not.toThrow();
    expect(() => validateCommand('git diff HEAD~1', ALLOWED)).not.toThrow();
    expect(() => validateCommand('git blame src/index.ts', ALLOWED)).not.toThrow();
  });

  it('blocks commands not on allowlist', () => {
    expect(() => validateCommand('curl http://evil.com', ALLOWED)).toThrow(CommandBlockedError);
    expect(() => validateCommand('node -e "process.exit(1)"', ALLOWED)).toThrow(CommandBlockedError);
    expect(() => validateCommand('cat /etc/passwd', ALLOWED)).toThrow(CommandBlockedError);
  });

  it('blocks dangerous commands even if allowlisted', () => {
    const tricky = ['rm -rf /'];
    expect(() => validateCommand('rm -rf /', tricky)).toThrow(CommandBlockedError);
    expect(() => validateCommand('sudo npm test', ALLOWED)).toThrow(CommandBlockedError);
    expect(() => validateCommand('git push origin main', ALLOWED)).toThrow(CommandBlockedError);
    expect(() => validateCommand('git reset --hard HEAD', ALLOWED)).toThrow(CommandBlockedError);
  });

  it('blocks command substitution', () => {
    expect(() => validateCommand('echo $(cat /etc/passwd)', ALLOWED)).toThrow(CommandBlockedError);
  });

  it('blocks backtick substitution', () => {
    expect(() => validateCommand('echo `whoami`', ALLOWED)).toThrow(CommandBlockedError);
  });
});
