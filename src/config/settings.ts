import { z } from 'zod';

const SettingsSchema = z.object({
  anthropicApiKey: z.string().min(1),
  gatewaySecret: z.string().min(8),
  githubToken: z.string().optional().default(''),
  githubDefaultOwner: z.string().min(1).default('mrmoe28'),
  reposBaseDir: z.string().min(1).default('data/repos'),
  port: z.number().default(7400),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  workerTimeoutMs: z.number().default(180000),
  commandTimeoutMs: z.number().default(30000),
  maxToolLoops: z.number().default(40),
  maxFileReadLines: z.number().default(500),
  maxSearchResults: z.number().default(20),
  maxToolResultChars: z.number().default(8000),
  approvalTimeoutMs: z.number().default(3600000),
  staleWorktreeMs: z.number().default(86400000),
  minDiskSpaceMb: z.number().default(1024),
  models: z.object({
    claudeCode: z.string().default('claude-sonnet-4-6'),
    claudeCodeEscalation: z.string().default('claude-opus-4-6'),
    coworkInvestigation: z.string().default('claude-sonnet-4-6'),
    coworkReview: z.string().default('claude-sonnet-4-6'),
  }).default({
    claudeCode: 'claude-sonnet-4-6',
    claudeCodeEscalation: 'claude-opus-4-6',
    coworkInvestigation: 'claude-sonnet-4-6',
    coworkReview: 'claude-sonnet-4-6',
  }),
});

export type Settings = z.infer<typeof SettingsSchema>;

let cachedSettings: Settings | null = null;

export function loadSettings(): Settings {
  if (cachedSettings) return cachedSettings;
  cachedSettings = SettingsSchema.parse({
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    gatewaySecret: process.env.GATEWAY_SECRET,
    githubToken: process.env.GITHUB_TOKEN,
    githubDefaultOwner: process.env.GITHUB_DEFAULT_OWNER,
    reposBaseDir: process.env.REPOS_BASE_DIR,
    port: process.env.GATEWAY_PORT ? parseInt(process.env.GATEWAY_PORT) : undefined,
    logLevel: process.env.LOG_LEVEL,
  });
  return cachedSettings;
}

export function resetSettingsCache(): void {
  cachedSettings = null;
}
