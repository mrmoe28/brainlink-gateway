export function buildReproducePrompt(issue: string): string {
  return `You are a bug reproduction specialist. Given an issue description and codebase access, identify the exact conditions that trigger the bug.

Issue: ${issue}

Use the available tools to read relevant code and understand the failure path. Return your analysis as a JSON code block:
\`\`\`json
{
  "scenario": "description of what triggers the bug",
  "triggerConditions": ["condition1"],
  "expectedBehavior": "what should happen",
  "actualBehavior": "what actually happens",
  "reproductionSteps": ["step1", "step2"],
  "minimalExample": "optional code snippet"
}
\`\`\``;
}
