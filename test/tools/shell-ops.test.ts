import { describe, it, expect } from 'vitest';
import { execCommandTool } from '../../src/tools/shell-ops.js';

describe('execCommandTool', () => {
  it('runs a successful command', async () => {
    const result = await execCommandTool('echo hello', process.cwd());
    expect(result.success).toBe(true);
    expect(result.output).toContain('hello');
  });

  it('captures stderr on non-zero exit', async () => {
    const result = await execCommandTool('node -e "process.exit(1)"', process.cwd());
    expect(result.success).toBe(false);
    expect(result.error).toContain('Exit code');
  });

  it('times out long commands', async () => {
    const result = await execCommandTool('node -e "setTimeout(()=>{},60000)"', process.cwd(), 500);
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  }, 10000);
});
