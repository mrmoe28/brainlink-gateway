export function generateTaskId(): string {
  return 'task_' + Math.random().toString(36).slice(2, 7);
}

export function generateSlug(description: string, maxLength: number = 40): string {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 4)
    .join('-')
    .slice(0, maxLength);
}

export function generateBranchName(taskId: string, description: string): string {
  const slug = generateSlug(description);
  return `brainlink/${taskId}/${slug}`;
}
