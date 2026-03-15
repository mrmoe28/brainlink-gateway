export function buildReviewPrompt(issue: string, diff: string): string {
  return `You are a code review specialist. Review this diff for correctness, edge cases, security issues, style consistency, and regressions.

Original issue: ${issue}

Diff to review:
\`\`\`
${diff}
\`\`\`

Use the tools to check surrounding code context. Return as a JSON code block:
\`\`\`json
{
  "approved": true,
  "concerns": [{ "severity": "warning", "file": "", "line": 0, "message": "" }],
  "suggestions": ["suggestion1"]
}
\`\`\``;
}
