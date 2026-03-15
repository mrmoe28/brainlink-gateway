export function buildRiskPrompt(issue: string): string {
  return `You are a risk analysis specialist. Assess the blast radius of the reported issue and any proposed fix.

Issue: ${issue}

Use the tools to search for similar patterns, identify affected code paths, and evaluate deployment risk. Return as a JSON code block:
\`\`\`json
{
  "blastRadius": "low",
  "affectedPaths": ["path1"],
  "similarIssues": [{ "file": "", "line": 0, "description": "" }],
  "deploymentRisk": "assessment",
  "recommendation": "what to do"
}
\`\`\``;
}
