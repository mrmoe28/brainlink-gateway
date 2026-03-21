/**
 * Brain Link — Claude Code Stop Hook
 * Finalizes a Claude Code session by sending the transcript to the gateway.
 * Runs when Claude Code stops (task complete or user exits).
 */

const GATEWAY_URL = 'http://localhost:7400';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => (raw += chunk));
process.stdin.on('end', async () => {
  try {
    const event = JSON.parse(raw);

    const sessionId = event.session_id || 'unknown';
    const cwd = event.cwd || '';

    // Extract last assistant message as the session summary
    let lastAssistantMessage = '';
    if (Array.isArray(event.transcript)) {
      for (let i = event.transcript.length - 1; i >= 0; i--) {
        const msg = event.transcript[i];
        if (msg.role === 'assistant') {
          if (typeof msg.content === 'string') {
            lastAssistantMessage = msg.content;
          } else if (Array.isArray(msg.content)) {
            lastAssistantMessage = msg.content
              .filter(b => b.type === 'text')
              .map(b => b.text)
              .join('\n');
          }
          break;
        }
      }
    }

    await fetch(`${GATEWAY_URL}/api/sessions/finalize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        cwd,
        lastAssistantMessage: lastAssistantMessage.slice(0, 1000),
        finishedAt: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Never block Claude Code
  }
});
