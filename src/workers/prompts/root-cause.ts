export function buildRootCausePrompt(issue: string): string {
  return `You are a root cause analysis specialist. Trace the execution path from entry to failure point. Follow the data flow.

Issue: ${issue}

Use the available tools to read code, check git history, and trace the call chain. Return as a JSON code block:
\`\`\`json
{
  "rootCause": "the fundamental reason for the failure",
  "callChain": ["function1 -> function2 -> failure point"],
  "errorType": "logic",
  "firstBadCommit": "optional commit hash",
  "confidence": 0.0
}
\`\`\``;
}
