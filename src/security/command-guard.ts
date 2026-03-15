import { GLOBAL_ALLOWED_COMMANDS, COMMAND_BLOCKLIST } from '../config/commands.js';

export class CommandBlockedError extends Error {
  constructor(command: string, reason: string) {
    super(`Command blocked: "${command}" -- ${reason}`);
    this.name = 'CommandBlockedError';
  }
}

export function validateCommand(command: string, repoAllowedCommands: string[]): void {
  const trimmed = command.trim();

  // Step 1: Check blocklist first (defense in depth)
  for (const pattern of COMMAND_BLOCKLIST) {
    if (pattern.test(trimmed)) {
      throw new CommandBlockedError(trimmed, 'matches blocklist');
    }
  }

  // Step 2: Check global git read commands
  for (const pattern of GLOBAL_ALLOWED_COMMANDS) {
    if (pattern.test(trimmed)) return;
  }

  // Step 3: Check repo-specific allowlist
  for (const allowed of repoAllowedCommands) {
    if (trimmed === allowed || trimmed.startsWith(allowed + ' ')) return;
  }

  throw new CommandBlockedError(trimmed, 'not on allowlist');
}
