/**
 * Brain Link — Claude Code PostToolUse Hook
 * Captures tool events from Claude Code sessions and sends them to the local gateway.
 * Fires after every tool use. Silently exits on any error so it never blocks Claude.
 */

const GATEWAY_URL = 'http://localhost:7400';

// Only capture tools that indicate real development work
const INTERESTING_TOOLS = new Set([
  'Write', 'Edit', 'Bash', 'Read', 'Glob', 'Grep',
  'MultiEdit', 'NotebookEdit', 'TodoWrite', 'TodoRead',
]);

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (raw += chunk));
process.stdin.on('end', async () => {
  try {
    const event = JSON.parse(raw);

    const toolName = event.tool_name || '';
    if (!INTERESTING_TOOLS.has(toolName)) return;

    const sessionId = event.session_id || 'unknown';
    const cwd = event.cwd || '';
    const toolInput = event.tool_input || {};
    const toolResponse = event.tool_response || {};

    // Build a compact, readable summary of what happened
    let summary = '';
    if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit') {
      const filePath = toolInput.file_path || toolInput.path || '';
      summary = `${toolName}: ${filePath}`;
    } else if (toolName === 'Bash') {
      const cmd = typeof toolInput.command === 'string'
        ? toolInput.command.slice(0, 120)
        : '';
      summary = `Bash: ${cmd}`;
    } else if (toolName === 'Read') {
      summary = `Read: ${toolInput.file_path || ''}`;
    } else if (toolName === 'Grep') {
      summary = `Grep: "${toolInput.pattern}" in ${toolInput.path || '.'}`;
    } else if (toolName === 'Glob') {
      summary = `Glob: ${toolInput.pattern}`;
    } else if (toolName === 'TodoWrite') {
      summary = `TodoWrite: ${(toolInput.todos || []).length} tasks`;
    } else {
      summary = toolName;
    }

    // Extract any error signals from the response
    let error = null;
    if (typeof toolResponse === 'string' && toolResponse.toLowerCase().includes('error')) {
      error = toolResponse.slice(0, 200);
    } else if (toolResponse?.error) {
      error = String(toolResponse.error).slice(0, 200);
    } else if (toolResponse?.stderr) {
      error = String(toolResponse.stderr).slice(0, 200);
    }

    const payload = {
      sessionId,
      cwd,
      toolName,
      summary,
      input: toolInput,
      error,
      timestamp: new Date().toISOString(),
    };

    await fetch(`${GATEWAY_URL}/api/sessions/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Never block Claude Code
  }
});
