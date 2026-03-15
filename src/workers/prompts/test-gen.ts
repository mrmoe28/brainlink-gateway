export function buildTestGenPrompt(issue: string, patchDescription: string): string {
  return `You are a regression test specialist. Generate tests that would have caught the reported bug and verify the fix.

Issue: ${issue}
Fix applied: ${patchDescription}

Use the tools to understand the project's test conventions (look at existing test files). Return as a JSON code block:
\`\`\`json
{
  "tests": [{
    "name": "test name",
    "file": "where the test should go",
    "code": "the test code",
    "type": "unit",
    "description": "what this test verifies"
  }]
}
\`\`\``;
}
