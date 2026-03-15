# Brain Link Local Agent System — Complete Design Specification

**Date:** 2026-03-15
**Status:** Draft
**Author:** Brain Link Architecture Session

---

## 1. Full System Architecture

```
                     BRAIN LINK (Samsung S24 Ultra)
                     React Native / Expo voice assistant
                     Voice/text input, approval UI, progress display
                              |
                              | WebSocket + REST
                              | via Cloudflare Tunnel (brainlink.lock28.com)
                              |
          +-------------------v--------------------+
          |     LOCAL AGENT GATEWAY (Node.js)       |
          |     Port 7400 on Desktop                |
          |                                         |
          |  +----------+  +---------+  +---------+ |
          |  | Auth &   |  | Path &  |  | Audit   | |
          |  | Request  |  | Command |  | Logger  | |
          |  | Router   |  | Guards  |  | (JSONL) | |
          |  +----+-----+  +----+----+  +----+----+ |
          |       |             |            |       |
          |  +----v-------------v------------v----+  |
          |  |         TOOL EXECUTOR              |  |
          |  |  file-ops | git-ops | shell-ops    |  |
          |  +--------------------+---------------+  |
          |                       |                  |
          |  +--------------------v---------------+  |
          |  |       WORKER ORCHESTRATOR           |  |
          |  |                                     |  |
          |  |  +-----------------+  +----------+  |  |
          |  |  | CLAUDE CODE    |  | COWORK   |  |  |
          |  |  | (Sonnet/Opus)  |  | DISPATCH |  |  |
          |  |  | Deep analysis, |  |          |  |  |
          |  |  | diagnosis,     |  | W1: Rep  |  |  |
          |  |  | patch gen      |  | W2: RCA  |  |  |
          |  |  |                |  | W3: Risk |  |  |
          |  |  |                |  | W4: Test |  |  |
          |  |  |                |  | W5: Rev  |  |  |
          |  |  +-------+-------+  +----+-----+  |  |
          |  |          |               |         |  |
          |  |  +-------v---------------v------+  |  |
          |  |  |     SYNTHESIS ENGINE         |  |  |
          |  |  |  Merge results -> decision   |  |  |
          |  |  +-------------+----------------+  |  |
          |  +----------------|-------------------+  |
          |                   |                      |
          |  +----------------v-------------------+  |
          |  |      APPROVAL MANAGER              |  |
          |  |  Queues writes, commits, PRs        |  |
          |  |  Auto-approves reads & diagnostics  |  |
          |  +------------------------------------+  |
          +------------------------------------------+
                              |
                        Claude API
                   (@anthropic-ai/sdk)
```

### Key Design Decisions

1. **Gateway is the only process with filesystem access.** Brain Link, Claude Code workers, and Cowork workers never touch the filesystem directly. They request tool executions from the gateway, which validates and executes them.

2. **Cloudflare Tunnel for connectivity.** `brainlink.lock28.com` tunnels to gateway on `localhost:7400`. Brain Link on the phone connects via this tunnel. Works from anywhere, not just local network.

3. **Claude Code Worker = single Sonnet/Opus API call** with repo-aware tools. Does the heavy thinking: diagnosis, architecture understanding, patch generation.

4. **Cowork Workers = parallel Haiku/Sonnet API calls** with focused prompts and read-only tools. 3-5 workers fire simultaneously for investigation, then results merge.

5. **Every tool call flows through the same security stack** regardless of which worker requested it.

---

## 2. Component Responsibilities

| Component | Role | Filesystem? | Shell? |
|-----------|------|------------|--------|
| **Brain Link** | Orchestrator + UI. Sends task requests, displays progress, handles approval | No | No |
| **Local Agent Gateway** | Security boundary + execution engine. Validates, executes tools, manages worktrees | Yes (guarded) | Yes (sandboxed) |
| **Claude Code Worker** | Deep analysis. Reads code via tools, understands architecture, generates patches | Via gateway tools | Via gateway tools |
| **Cowork Workers** | Parallel investigation. Each worker has a focused task | Via gateway tools (read-only) | Via gateway tools (read-only) |
| **Synthesis Engine** | Merges worker outputs into single structured decision with confidence scores | No | No |
| **Approval Manager** | State machine for human-gated actions (writes, commits, PRs) | No | No |

---

## 3. End-to-End Workflow

### Phase 1 — Intake

```
Moe: "The Stripe webhook in Solar Service OS is throwing 500 on subscription updates"

Brain Link converts to:
{
  "type": "fix",
  "repo": "solar-service-os",
  "description": "Stripe webhook throwing 500 on subscription updates",
  "priority": "normal"
}

Gateway validates -> repo approved, auth valid -> creates task_abc123
Gateway creates worktree:
  git worktree add .worktrees/task_abc123 -b brainlink/task_abc123/stripe-webhook-500 main
```

### Phase 2 — Investigation (parallel)

```
Claude Code Worker (Sonnet):
  -> reads app/api/stripe/webhook/route.ts
  -> reads lib/stripe/index.ts
  -> searches for "subscription" across codebase
  -> reads related test files
  -> returns: diagnosis + candidate patch

Cowork Worker 1 (Haiku) — Reproduce:
  -> reads webhook handler + types
  -> identifies missing null check on subscription object
  -> returns: reproduction scenario

Cowork Worker 2 (Haiku) — Root Cause:
  -> traces data flow from webhook -> handler -> DB
  -> identifies: subscription.items may be undefined for certain event types
  -> returns: root cause analysis

Cowork Worker 3 (Haiku) — Risk:
  -> reads all callers of the affected function
  -> checks for similar patterns elsewhere
  -> returns: blast radius assessment (2 other handlers have same pattern)
```

### Phase 3 — Synthesis

```
Synthesis Engine merges:
  - Diagnosis: confirmed null reference on subscription.items
  - Root cause: customer.subscription.updated events don't always include items
  - Patch: add optional chaining + early return for missing data
  - Risk: 2 other webhook handlers need same fix
  - Confidence: 0.92
```

### Phase 4 — Validation

```
Gateway applies patch to worktree, then runs:
  - npm test (in worktree)
  - npm run lint (in worktree)
  - Cowork Worker (Sonnet): reviews the actual diff for quality
```

### Phase 5 — Approval

```
Gateway -> Brain Link (via WebSocket):
{
  "taskId": "task_abc123",
  "status": "awaiting_approval",
  "diagnosis": "Null reference on subscription.items in webhook handler",
  "patch": { "files": [...], "diff": "..." },
  "testResults": { "passed": 47, "failed": 0 },
  "riskAssessment": "Low risk, 2 other handlers flagged for same pattern",
  "actions": ["apply_and_commit", "apply_commit_and_pr", "reject"]
}

Moe reviews on phone -> approves "apply_and_commit"
```

### Phase 6 — Apply

```
Gateway:
  1. Merges worktree branch into working branch
  2. Creates commit with audit metadata
  3. Cleans up worktree
  4. Logs everything to audit trail
```

---

## 4. Local Agent Gateway API Design

### HTTP API (Express, port 7400)

#### Authentication

All requests require `X-Gateway-Key` header matching the configured secret.

#### Endpoints

##### POST /api/tasks

Create a new task.

```
Request:
{
  "type": "diagnose" | "fix" | "investigate" | "test" | "review",
  "repo": "solar-service-os",
  "description": "Stripe webhook throwing 500 on subscription updates",
  "files": ["app/api/stripe/webhook/route.ts"],
  "branch": "main",
  "priority": "normal" | "urgent"
}

Response:
{
  "taskId": "task_abc123",
  "status": "pending",
  "worktreeBranch": "brainlink/task_abc123/stripe-webhook-500",
  "createdAt": "2026-03-15T10:30:00Z"
}
```

##### GET /api/tasks/:id

Get full task status including worker results, patches, and approval state.

```
Response: Full TaskState object (see Section 5)
```

##### POST /api/tasks/:id/approve

Approve or reject a pending action.

```
Request:
{
  "action": "apply_and_commit" | "apply_commit_and_pr" | "reject",
  "commitMessage": "optional custom commit message"
}

Response:
{
  "taskId": "task_abc123",
  "status": "applying" | "rejected",
  "commitSha": "abc1234",
  "prUrl": "https://github.com/..."
}
```

##### POST /api/tasks/:id/rollback

Trigger rollback of applied changes.

```
Response:
{
  "taskId": "task_abc123",
  "status": "rolled_back",
  "rollbackMethod": "worktree_discard" | "git_revert",
  "revertSha": "def5678"
}
```

##### GET /api/repos

List all approved repositories.

```
Response:
{
  "repos": [
    {
      "key": "solar-service-os",
      "path": "C:/Users/Dell/Desktop/Solar Service OS",
      "defaultBranch": "main",
      "activeWorktrees": 1
    }
  ]
}
```

##### GET /api/audit

Query audit log with filters.

```
Query params: ?taskId=&after=&before=&action=&actor=&limit=100
Response:
{
  "entries": [ AuditEntry, ... ],
  "total": 245
}
```

##### GET /api/health

```
Response:
{
  "status": "ok",
  "uptime": 3600,
  "activeWorktrees": 2,
  "pendingApprovals": 1
}
```

### WebSocket API (port 7400, path /ws)

After creating a task, connect to WebSocket to receive streaming updates:

```
// Client sends after connecting:
{ "type": "auth", "key": "gateway-secret" }
{ "type": "subscribe", "taskId": "task_abc123" }

// Server streams:
{ "type": "progress", "taskId": "task_abc123", "phase": "investigating", "worker": "claude-code", "message": "Reading webhook handler..." }
{ "type": "tool_call", "taskId": "task_abc123", "worker": "claude-code", "tool": "read_file", "args": { "path": "app/api/stripe/webhook/route.ts" } }
{ "type": "worker_complete", "taskId": "task_abc123", "worker": "reproduce", "summary": "Identified null reference trigger" }
{ "type": "worker_complete", "taskId": "task_abc123", "worker": "root-cause", "summary": "subscription.items undefined on update events" }
{ "type": "synthesis_complete", "taskId": "task_abc123", "confidence": 0.92 }
{ "type": "validation_complete", "taskId": "task_abc123", "passed": true }
{ "type": "approval_required", "taskId": "task_abc123", "payload": { ... } }
{ "type": "task_complete", "taskId": "task_abc123", "status": "completed" }
```

### WebSocket Reconnection Protocol

Brain Link runs on a mobile phone that switches between WiFi and cellular. Disconnections are expected.

- **Server-side ping**: Every 30 seconds. If no pong received within 10s, server considers client disconnected.
- **Client-side reconnect**: Automatic with exponential backoff: 1s, 2s, 4s, 8s, max 30s.
- **State sync on reconnect**: After re-authenticating, client sends `{ "type": "sync", "taskIds": ["task_abc123"] }`. Server responds with current state for each subscribed task.
- **Pending approval re-delivery**: If a task is in `awaiting_approval` when the client reconnects, server re-sends the `approval_required` message.
- **Missed events**: Server buffers the last 50 events per task. On reconnect, client sends `{ "type": "replay", "taskId": "task_abc123", "afterTimestamp": "..." }` to receive missed events.

### Transport Security

The Cloudflare Tunnel (`brainlink.lock28.com`) provides TLS termination. All traffic between Brain Link and the gateway is encrypted in transit via HTTPS/WSS. The `X-Gateway-Key` is never transmitted in plaintext.

---

## 5. JSON Schemas

### TaskRequest

```typescript
interface TaskRequest {
  type: 'diagnose' | 'fix' | 'investigate' | 'test' | 'review';
  repo: string;           // key from repos.json
  description: string;
  files?: string[];        // optional focus files
  branch?: string;         // optional source branch (defaults to repo default)
  priority: 'normal' | 'urgent';
}
```

### TaskState

```typescript
interface TaskState {
  taskId: string;
  status: TaskStatus;
  repo: string;
  worktreePath: string;
  worktreeBranch: string;
  createdAt: string;
  updatedAt: string;

  // Phase results
  diagnosis?: Diagnosis;
  patch?: Patch;
  workerResults: WorkerResult[];
  synthesis?: Synthesis;
  validation?: ValidationResult;
  approval?: ApprovalRecord;

  // Audit
  auditTrail: AuditEntry[];
}

type TaskStatus =
  | 'pending'
  | 'investigating'
  | 'synthesizing'
  | 'validating'
  | 'awaiting_approval'
  | 'applying'
  | 'completed'
  | 'failed'
  | 'rolled_back'
  | 'rejected'
  | 'expired';
```

### Diagnosis

```typescript
interface Diagnosis {
  summary: string;          // one-line summary
  rootCause: string;        // detailed root cause explanation
  affectedFiles: string[];  // files involved in the issue
  confidence: number;       // 0.0 - 1.0
  evidence: string[];       // "file.ts:42 -- description" format
}
```

### Patch

```typescript
interface Patch {
  files: PatchFile[];
  description: string;
  diffStat: {
    additions: number;
    deletions: number;
    filesChanged: number;
  };
}

interface PatchFile {
  path: string;
  action: 'modify' | 'create' | 'delete';
  diff: string;         // unified diff format
  before?: string;      // original content — for display in approval UI (optional for 'create', required for 'modify')
  after: string;         // new content (empty string for 'delete')
}
```

### WorkerResult

```typescript
interface WorkerResult {
  workerId: string;
  workerType: WorkerType;
  status: 'completed' | 'failed' | 'timed_out';
  model: string;
  result: any;           // worker-type-specific (see Section 7)
  tokensUsed: number;
  durationMs: number;
  error?: string;
}

type WorkerType =
  | 'claude-code'
  | 'reproduce'
  | 'root-cause'
  | 'test-gen'
  | 'review'
  | 'risk'
  | 'test-run'
  | 'lint-run'
  | 'diff-review';
```

### Synthesis

```typescript
interface Synthesis {
  summary: string;
  rootCause: string;
  confidence: number;
  agreementScore: number;    // how much workers agreed (0-1)
  conflicts: string[];       // areas where workers disagreed
  recommendation: 'proceed' | 'needs_review' | 'insufficient_data';
  additionalIssues: string[];
}
```

### ValidationResult

```typescript
interface ValidationResult {
  tests: {
    command: string;
    passed: number;
    failed: number;
    skipped: number;
    output: string;        // truncated to last 200 lines
    durationMs: number;
  } | null;
  lint: {
    command: string;
    errors: number;
    warnings: number;
    output: string;
    durationMs: number;
  } | null;
  build: {
    command: string;
    success: boolean;
    output: string;
    durationMs: number;
  } | null;
  typecheck: {
    command: string;
    success: boolean;
    output: string;
    durationMs: number;
  } | null;
  diffReview: {
    approved: boolean;
    concerns: DiffConcern[];
    suggestions: string[];
  } | null;
  overallPass: boolean;
}

interface DiffConcern {
  severity: 'critical' | 'warning' | 'nit';
  file: string;
  line?: number;
  message: string;
}
```

### ApprovalRecord

```typescript
interface ApprovalRecord {
  required: boolean;
  availableActions: ApprovalAction[];
  requestedAt: string;
  expiresAt: string;        // 1 hour from requestedAt
  decidedAt?: string;
  decision?: 'approved' | 'rejected';
  chosenAction?: string;
  commitSha?: string;
  prUrl?: string;
}

interface ApprovalAction {
  id: string;
  label: string;
  description: string;
}
```

### AuditEntry

```typescript
interface AuditEntry {
  timestamp: string;
  taskId: string;
  action: AuditAction;
  actor: 'gateway' | 'claude-code' | 'cowork-worker' | 'user';
  details: Record<string, any>;
}

type AuditAction =
  | 'task_created'
  | 'worktree_created'
  | 'worktree_removed'
  | 'file_read'
  | 'file_written'
  | 'directory_listed'
  | 'content_searched'
  | 'command_executed'
  | 'command_blocked'
  | 'path_blocked'
  | 'worker_started'
  | 'worker_completed'
  | 'worker_failed'
  | 'patch_generated'
  | 'patch_applied'
  | 'validation_started'
  | 'validation_completed'
  | 'approval_requested'
  | 'approval_granted'
  | 'approval_rejected'
  | 'commit_created'
  | 'pr_opened'
  | 'rollback_triggered'
  | 'worker_timed_out'
  | 'approval_expired'
  | 'push_executed'
  | 'rollback_completed';
```

---

## 6. Claude Code Invocation Contract

### Model Selection

| Scenario | Model | Rationale |
|----------|-------|-----------|
| Primary analysis & patch gen | `claude-sonnet-4-6` | Fast, capable, cost-effective |
| Low confidence retry (< 0.7) | `claude-opus-4-6` | Higher capability for complex cases |
| Cowork investigation workers | `claude-haiku-4-5` | Fast, cheap, focused tasks |
| Cowork diff review worker | `claude-sonnet-4-6` | Needs deeper understanding |

### System Prompt (Claude Code Worker)

```
You are Claude Code, a repo-aware code analysis engine operating within the
Brain Link Local Agent system.

You have tools to read files, search code, inspect git history, and write
patches for a specific repository. All tool calls are executed by the Local
Agent Gateway in an isolated git worktree.

Your job:
1. Understand the codebase structure and conventions
2. Diagnose the reported issue using the available tools
3. Generate a precise, minimal patch that fixes the issue
4. Return structured JSON with your diagnosis and patch

Rules:
- Read before writing. Understand conventions before generating patches.
- Make minimal changes. Do not refactor unrelated code.
- Follow existing patterns. Match the codebase style and architecture.
- Be precise. Cite specific files and line numbers.
- Your final message MUST contain a JSON code block with the result schema.

Repository: {{repo_name}}
Branch: {{branch_name}}
Issue: {{description}}
Focus files: {{files_or_none}}
```

### Tool Definitions (Claude Code Worker)

The Claude Code worker has access to 8 tools:

```typescript
const CLAUDE_CODE_TOOLS = [
  {
    name: 'read_file',
    description: 'Read file contents from the worktree. Returns line-numbered content.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path from repo root' },
        start_line: { type: 'number', description: 'Start line (optional)' },
        end_line: { type: 'number', description: 'End line (optional)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_directory',
    description: 'List files and directories at a path in the worktree.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path from repo root. Use "." for root.' },
        recursive: { type: 'boolean', description: 'Include subdirectories (default false)' },
        pattern: { type: 'string', description: 'Glob filter (e.g. "*.ts")' },
      },
      required: ['path'],
    },
  },
  {
    name: 'search_content',
    description: 'Search file contents using regex (like ripgrep).',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern to search for' },
        path: { type: 'string', description: 'Directory to search in (default: repo root)' },
        file_pattern: { type: 'string', description: 'Glob to filter files (e.g. "*.ts")' },
        context_lines: { type: 'number', description: 'Lines of context (default: 2)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'git_log',
    description: 'Get git commit history for the repo or a specific file.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path for file-specific history' },
        count: { type: 'number', description: 'Number of commits (default: 10)' },
      },
    },
  },
  {
    name: 'git_diff',
    description: 'Get diff between git refs or for working tree changes.',
    input_schema: {
      type: 'object',
      properties: {
        ref1: { type: 'string', description: 'First ref (default: HEAD)' },
        ref2: { type: 'string', description: 'Second ref' },
        path: { type: 'string', description: 'File path filter' },
      },
    },
  },
  {
    name: 'git_blame',
    description: 'Get git blame for a file, showing who changed each line.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        start_line: { type: 'number' },
        end_line: { type: 'number' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file in the worktree. Use for generating patches.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative path from repo root' },
        content: { type: 'string', description: 'Complete file content' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'run_command',
    description: 'Execute an approved shell command in the worktree. Only allowlisted commands work.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to run' },
        timeout_ms: { type: 'number', description: 'Timeout in ms (default: 30000, max: 120000)' },
      },
      required: ['command'],
    },
  },
];
```

### File Deletion

File deletion is handled through the patch mechanism, not a separate tool. When the Claude Code worker determines a file should be deleted, it includes a `PatchFile` with `action: 'delete'` in its response. The gateway applies this during the apply phase (after approval), not during investigation. Workers cannot delete files during the tool loop.

### Context Window Management

The gateway tracks approximate token usage during the tool call loop:

- **Max file read size**: 500 lines by default. Workers must use `start_line`/`end_line` for larger files.
- **Search result truncation**: `search_content` returns max 20 matches. Workers narrow with `file_pattern` or `path`.
- **Tool result truncation**: Any single tool result > 8000 characters is truncated with `[truncated, showing first 8000 chars]`.
- **Token budget**: Gateway tracks cumulative tool result size. At 80% of estimated context budget (100K tokens for Sonnet, 200K for Opus), gateway injects a system message: "Context budget at 80%. Wrap up your analysis and return your structured result."
- **Max tool loops**: 20. If reached, gateway forces the worker to return whatever it has.
- **Large file strategy**: If a worker reads a file that exceeds 500 lines, the gateway returns the first 500 lines plus a note: `[File has N total lines. Use start_line/end_line to read specific sections.]`

### Expected Response Format

The Claude Code worker's final message must contain:

```json
{
  "diagnosis": {
    "summary": "Null reference on subscription.items in webhook handler",
    "rootCause": "customer.subscription.updated events may not include the items array when only metadata changes",
    "affectedFiles": ["app/api/stripe/webhook/route.ts"],
    "confidence": 0.92,
    "evidence": [
      "app/api/stripe/webhook/route.ts:47 -- accesses subscription.items.data without null check",
      "lib/stripe/index.ts:23 -- no validation on webhook payload shape"
    ]
  },
  "patch": {
    "files": [
      {
        "path": "app/api/stripe/webhook/route.ts",
        "action": "modify",
        "diff": "--- a/app/api/stripe/webhook/route.ts\n+++ b/app/api/stripe/webhook/route.ts\n@@ -45,3 +45,5 @@\n...",
        "after": "// full file content after changes"
      }
    ],
    "description": "Added optional chaining and early return for subscription events without items data"
  },
  "additionalIssues": [
    "app/api/stripe/webhook/route.ts:82 -- similar pattern in invoice handler"
  ]
}
```

### Tool Call Loop

The gateway runs the tool loop for each worker:

```
1. Send initial message to Claude API with system prompt + tools
2. If response has stop_reason === 'tool_use':
   a. Extract tool_use blocks
   b. For each tool call:
      - Validate via path-guard / command-guard
      - Execute via tool executor
      - Log to audit
   c. Send tool_results back to Claude API
   d. Repeat from step 2
3. If response has stop_reason === 'end_turn':
   - Extract JSON from final text response
   - Return structured result
4. Max tool loops: 20 (prevents runaway)
```

---

## 7. Cowork Task Orchestration Contract

### Worker Types

Each worker type has a fixed system prompt and restricted tool set.

#### reproduce (Haiku)

- **Tools**: read_file, list_directory, search_content (read-only)
- **Prompt**: "You are a bug reproduction specialist. Given an issue description and codebase access, identify the exact conditions that trigger the bug. Return structured JSON."
- **Returns**:

```typescript
interface ReproduceResult {
  scenario: string;
  triggerConditions: string[];
  expectedBehavior: string;
  actualBehavior: string;
  reproductionSteps: string[];
  minimalExample?: string;
}
```

#### root-cause (Haiku)

- **Tools**: read_file, list_directory, search_content, git_log, git_blame (read-only)
- **Prompt**: "You are a root cause analysis specialist. Trace the execution path from entry to failure. Follow the data flow. Return structured JSON."
- **Returns**:

```typescript
interface RootCauseResult {
  rootCause: string;
  callChain: string[];      // ordered list of function calls to failure
  errorType: 'logic' | 'data_handling' | 'race_condition' | 'config' | 'type_error' | 'missing_validation';
  firstBadCommit?: string;
  confidence: number;
}
```

#### test-gen (Haiku)

- **Tools**: read_file, list_directory, search_content (read-only)
- **Prompt**: "You are a regression test specialist. Given an issue and proposed fix, generate tests that would have caught the bug and verify the fix. Follow existing test conventions."
- **Returns**:

```typescript
interface TestGenResult {
  tests: Array<{
    name: string;
    file: string;          // where the test should go
    code: string;          // test code
    type: 'unit' | 'integration';
    description: string;
  }>;
}
```

#### review (Sonnet)

- **Tools**: read_file, list_directory, search_content, git_diff (read-only)
- **Prompt**: "You are a code review specialist. Review the provided diff for correctness, edge cases, security issues, style consistency, and regressions. Be specific with file and line references."
- **Returns**:

```typescript
interface ReviewResult {
  approved: boolean;
  concerns: Array<{
    severity: 'critical' | 'warning' | 'nit';
    file: string;
    line?: number;
    message: string;
  }>;
  suggestions: string[];
}
```

#### risk (Haiku)

- **Tools**: read_file, list_directory, search_content (read-only)
- **Prompt**: "You are a risk analysis specialist. Assess blast radius, find similar patterns elsewhere, evaluate deployment risk. Return structured JSON."
- **Returns**:

```typescript
interface RiskResult {
  blastRadius: 'low' | 'medium' | 'high';
  affectedPaths: string[];
  similarIssues: Array<{
    file: string;
    line?: number;
    description: string;
  }>;
  deploymentRisk: string;
  recommendation: string;
}
```

### Dispatch Protocol

```typescript
interface CoworkDispatch {
  taskId: string;
  workers: WorkerSpec[];
  timeout: number;           // ms, default 60000
  failurePolicy: 'continue' | 'abort';  // 'continue' = collect partial results
}

interface WorkerSpec {
  type: WorkerType;
  model: string;
  systemPrompt: string;
  tools: ToolDefinition[];   // restricted subset
  context: {
    issue: string;
    repo: string;
    worktreePath: string;
    patch?: Patch;            // for review/risk workers
    focusFiles?: string[];
  };
}
```

### Parallel Execution

All workers dispatch as concurrent `Promise.allSettled()` calls:

```typescript
async function dispatchCoworkWorkers(
  spec: CoworkDispatch
): Promise<WorkerResult[]> {
  const promises = spec.workers.map((worker) =>
    executeWorker(worker, spec.taskId, spec.timeout)
  );

  const settled = await Promise.allSettled(promises);

  return settled.map((result, i) => ({
    workerId: `${spec.taskId}_${spec.workers[i].type}`,
    workerType: spec.workers[i].type,
    status: result.status === 'fulfilled' ? 'completed' :
            result.reason?.name === 'TimeoutError' ? 'timed_out' : 'failed',
    model: spec.workers[i].model,
    result: result.status === 'fulfilled' ? result.value : null,
    tokensUsed: /* tracked per call */,
    durationMs: /* measured */,
    error: result.status === 'rejected' ? result.reason.message : undefined,
  }));
}
```

### Investigation vs Validation Workers

Workers are dispatched in two phases:

**Phase A — Investigation** (run during diagnosis):
- reproduce, root-cause, risk
- Run in parallel WITH the Claude Code worker

**Phase B — Validation** (run after patch is generated):
- test-gen, review
- Run after patch exists, before approval
- Automated validation (tests, lint, build) also runs in this phase

---

## 8. Approval and Rollback Workflow

### Task State Machine

```
pending
  |
  v
investigating  (Claude Code + Cowork workers running)
  |
  v
synthesizing   (merging worker results)
  |
  v
validating     (tests, lint, build, diff review)
  |
  v
awaiting_approval  -----> rejected  (user rejects, worktree cleaned up)
  |
  v
applying       (patch merged, commit created)
  |
  v
completed

Any state can also transition to:
  failed       (unrecoverable error)
  rolled_back  (rollback triggered from completed/applying/failed)
  expired      (approval timeout hit)
```

### Actions Requiring Human Approval

| Action | Approval Required? |
|--------|-------------------|
| Read files | No |
| Search code | No |
| Git log / blame / diff | No |
| Run tests / lint (read-only) | No |
| Write files to isolated worktree | No |
| Merge worktree branch to working branch | **Yes** |
| Create git commit | **Yes** |
| Push to remote | **Yes** |
| Create / open PR | **Yes** |
| Delete files | **Yes** |

### Approval Payload (sent to Brain Link via WebSocket)

```json
{
  "taskId": "task_abc123",
  "status": "awaiting_approval",
  "summary": "Fix null reference in Stripe webhook handler",
  "diagnosis": {
    "summary": "...",
    "confidence": 0.92
  },
  "patch": {
    "diffStat": { "additions": 5, "deletions": 1, "filesChanged": 1 },
    "diff": "unified diff content..."
  },
  "validation": {
    "tests": { "passed": 47, "failed": 0 },
    "lint": { "errors": 0, "warnings": 3 },
    "build": { "success": true },
    "diffReview": { "approved": true, "concerns": [] }
  },
  "riskAssessment": {
    "blastRadius": "low",
    "similarIssues": [{ "file": "...", "description": "..." }]
  },
  "availableActions": [
    { "id": "apply_and_commit", "label": "Apply & Commit", "description": "Merge fix to branch and commit" },
    { "id": "apply_commit_and_pr", "label": "Apply, Commit & PR", "description": "Merge, commit, push, and open PR" },
    { "id": "reject", "label": "Reject", "description": "Discard the fix and clean up" }
  ],
  "expiresAt": "2026-03-15T11:30:00Z"
}
```

### Rollback Procedure

| State When Rollback Triggered | Rollback Action |
|-------------------------------|-----------------|
| Worktree changes not merged | Remove worktree: `git worktree remove`, delete branch |
| Changes merged but not committed | `git checkout -- .` on affected files |
| Changes committed | `git revert <sha>` (new commit, never force-push) |
| PR opened | Close PR with comment, then `git revert` |

All rollback actions are logged in audit trail.

### Approval Timeout

- Default timeout: 1 hour
- If no response, task status moves to `expired`
- Worktree is preserved for 24 hours, then auto-cleaned
- Moe can resume expired tasks via `POST /api/tasks/:id/approve`

---

## 9. Security Model, Permission Model, and Audit Logging

### Authentication

| Connection | Method |
|------------|--------|
| Brain Link -> Gateway | Shared secret in `X-Gateway-Key` header |
| Gateway -> Claude API | Anthropic API key in `.env` (never exposed to workers) |
| WebSocket auth | API key sent in first message after connection |

### Repository Allowlist (repos.json)

```json
{
  "solar-service-os": {
    "path": "C:/Users/Dell/Desktop/Solar Service OS",
    "defaultBranch": "main",
    "allowedCommands": [
      "npm test",
      "npm run lint",
      "npm run build",
      "npx tsc --noEmit"
    ],
    "blockedPaths": [".env", ".env.local", "*.pem", "*.key"],
    "maxWorktrees": 3
  },
  "modex": {
    "path": "C:/Users/Dell/Desktop/modex",
    "defaultBranch": "master",
    "allowedCommands": [
      "npm test",
      "npm run lint",
      "npm run build"
    ],
    "blockedPaths": [".env", "desktop/scripts/*.key"],
    "maxWorktrees": 2
  }
}
```

### Path Guard Rules

1. All file paths are resolved to absolute paths before any operation
2. Resolved path MUST start with an approved repo path (from repos.json)
3. No `..` segments allowed after resolution
4. No symlink following outside the repo root
5. Blocked paths (from repo config) are rejected
6. Global blocked patterns: `.env*`, `.git/config`, `*.pem`, `*.key`, `*credentials*`, `*secret*`
7. Path guard is called BEFORE every file operation — no exceptions

```typescript
function validatePath(requestedPath: string, repoConfig: RepoConfig): string {
  const resolved = path.resolve(repoConfig.worktreePath, requestedPath);

  // Must be within repo
  if (!resolved.startsWith(repoConfig.worktreePath)) {
    throw new SecurityError(`Path traversal blocked: ${requestedPath}`);
  }

  // Check blocked patterns
  for (const pattern of [...GLOBAL_BLOCKED, ...repoConfig.blockedPaths]) {
    if (minimatch(path.relative(repoConfig.worktreePath, resolved), pattern)) {
      throw new SecurityError(`Blocked path: ${requestedPath}`);
    }
  }

  return resolved;
}
```

### Command Guard Rules

```typescript
// Global commands always allowed (read-only git)
const GLOBAL_ALLOWED = [
  /^git\s+status$/,
  /^git\s+log\b/,
  /^git\s+diff\b/,
  /^git\s+blame\b/,
  /^git\s+branch\b/,
  /^git\s+show\b/,
  /^git\s+rev-parse\b/,
];

// Per-repo commands added from repos.json allowedCommands

// Hardcoded blocklist — secondary defense (allowlist is primary boundary)
// These catch dangerous patterns even if somehow added to an allowlist
const COMMAND_BLOCKLIST = [
  /\brm\b.*-[a-z]*r[a-z]*f|rm\b.*-[a-z]*f[a-z]*r|rm\s+--recursive|rm\s+--force/,
  /\bsudo\b/,
  /\bchmod\b/,
  /\bchown\b/,
  /curl.*\|.*sh/,
  /\bwget\b/,
  /\bnc\s/,
  /\beval\b/,
  /\bexec\b/,
  /`[^`]+`/,              // backtick command substitution
  /\$\([^)]+\)/,          // $() command substitution
  />\s*\/dev\//,
  /git\s+push/,           // push requires explicit approval flow
  /git\s+reset\s+--hard/,
  /git\s+checkout\s+\./,
  /git\s+clean\s+-f/,
  /npm\s+publish/,
  /\bkill\b/,
  /\bpkill\b/,
];

// IMPORTANT: The allowlist (GLOBAL_ALLOWED + repo allowedCommands) is the
// PRIMARY security boundary. Commands must match an allowlist entry to execute.
// The blocklist above is a secondary defense-in-depth layer.
```

### Audit Logging

All actions logged to `logs/audit-YYYY-MM-DD.jsonl` (one JSON object per line):

```json
{
  "timestamp": "2026-03-15T10:30:15.123Z",
  "taskId": "task_abc123",
  "action": "file_read",
  "actor": "claude-code",
  "details": {
    "path": "app/api/stripe/webhook/route.ts",
    "worktree": ".worktrees/task_abc123",
    "bytesRead": 4521,
    "durationMs": 12
  }
}
```

**All logged actions:**

`task_created`, `worktree_created`, `worktree_removed`, `file_read`, `file_written`, `directory_listed`, `content_searched`, `command_executed`, `command_blocked`, `path_blocked`, `worker_started`, `worker_completed`, `worker_failed`, `worker_timed_out`, `patch_generated`, `patch_applied`, `validation_started`, `validation_completed`, `approval_requested`, `approval_granted`, `approval_rejected`, `approval_expired`, `commit_created`, `push_executed`, `pr_opened`, `rollback_triggered`, `rollback_completed`

### Permission Matrix

| Actor | Read files | Write files | Run commands | Git write ops | Approve |
|-------|-----------|-------------|--------------|--------------|---------|
| Brain Link | No | No | No | No | **Yes** |
| Claude Code Worker | Yes (via tools) | Yes (worktree only) | Yes (allowlist) | No | No |
| Cowork Workers | Yes (via tools) | **No** | Read-only commands | No | No |
| Gateway (internal) | Yes | Yes | Yes (allowlist) | Yes (after approval) | No |
| Moe (via Brain Link) | -- | -- | -- | -- | **Yes** |

---

## 10. Branch/Workspace Isolation Model

### Git Worktree Lifecycle

```
1. Task created
   > git worktree add .worktrees/{taskId} -b brainlink/{taskId}/{slug} {sourceBranch}
   > Result: isolated copy of repo at .worktrees/{taskId}/

2. Workers operate inside worktree
   > All file reads scoped to .worktrees/{taskId}/
   > All file writes scoped to .worktrees/{taskId}/
   > All commands executed with cwd = .worktrees/{taskId}/

3. Validation runs inside worktree
   > cd .worktrees/{taskId} && npm install && npm test

4a. Approved -> merge
   > cd {repoRoot}
   > git merge --no-ff brainlink/{taskId}/{slug} -m "Brain Link: {description}"
   > git worktree remove .worktrees/{taskId}
   > git branch -d brainlink/{taskId}/{slug}

4b. Rejected -> cleanup
   > git worktree remove --force .worktrees/{taskId}
   > git branch -D brainlink/{taskId}/{slug}
```

### Branch Naming Convention

```
brainlink/{taskId}/{slug}

Examples:
  brainlink/task_m5x7a/stripe-webhook-500
  brainlink/task_k9p2b/fix-auth-redirect
  brainlink/task_j3q8c/add-invoice-validation
```

- `taskId`: `task_` + random 5-char base36 string
- `slug`: first 4 words of description, kebab-cased, max 40 chars
- Auto-generated, no user input needed

### Worktree Limits

- Max concurrent worktrees per repo: configurable in repos.json (default: 3)
- Gateway refuses to create new worktree if limit reached
- Stale worktree cleanup: worktrees with no state change for 24 hours are auto-removed (timer starts from last `updatedAt` timestamp in task state, not from creation time)
- Disk check: gateway verifies 500MB+ free space before creating worktree

### Dependency Installation in Worktrees

Git worktrees share `.git` but NOT `node_modules`. Each worktree needs its own dependencies. Strategy:

1. **Use pnpm** for repos that support it. pnpm's content-addressable store deduplicates packages across worktrees, reducing disk from ~500MB per worktree to ~50MB of symlinks.
2. **Only install if needed**: Skip `npm install` / `pnpm install` unless the patch modified `package.json` or `package-lock.json`.
3. **Shallow install**: For validation-only worktrees (just running tests), copy the main repo's `node_modules` via symlink or hardlink if possible.
4. **Disk budget**: Gateway checks for 1GB free space before creating a worktree (not 500MB). Configurable in settings.

### Windows-Specific Concerns

The gateway runs on Windows 11 with Git Bash. Known issues and mitigations:

1. **Long paths**: Enable `git config --global core.longpaths true`. Branch names are kept short (max 40 char slug). `.worktrees/` prefix is short by design.
2. **File locking**: Before `git worktree remove`, gateway kills any child processes spawned for that task (tracked by PID). If removal still fails due to locks, retry after 5s, then force remove.
3. **Path normalization**: All paths internally use forward slashes (POSIX style). `repos.json` paths are normalized on load via `path.resolve()` then converted to forward slashes. Path comparison always uses normalized forms.
4. **Line endings**: Gateway does not modify git's `autocrlf` setting. Files are read and written as-is.

### Isolation Guarantees

1. Each task gets its own worktree — tasks cannot interfere
2. Main repo working directory is NEVER modified by workers
3. Worktree is the ONLY writable filesystem location for workers
4. `.worktrees/` is added to `.gitignore` automatically
5. Worker A cannot read/write Worker B's worktree

---

## 11. Validation Flow

### Command Auto-Detection

The gateway detects available validation commands by inspecting the repo:

```typescript
async function detectValidation(worktreePath: string): Promise<ValidationConfig> {
  const pkgPath = path.join(worktreePath, 'package.json');
  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));

  return {
    test: pkg.scripts?.test ? 'npm test' : null,
    lint: pkg.scripts?.lint
      ? 'npm run lint'
      : (await anyFileExists(worktreePath, ['.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.yml', 'eslint.config.js', 'eslint.config.mjs']))
        ? 'npx eslint . --ext .ts,.tsx'
        : null,
    build: pkg.scripts?.build ? 'npm run build' : null,
    typecheck: pkg.scripts?.typecheck
      ? 'npm run typecheck'
      : (await fileExists(path.join(worktreePath, 'tsconfig.json')))
        ? 'npx tsc --noEmit'
        : null,
  };
}
```

### Validation Pipeline

Runs sequentially, stops on critical failure:

```
1. npm install (if needed — only if patch created/modified package.json)
2. TypeCheck  -> pass/fail
3. Lint       -> pass/fail (warnings don't block)
4. Test       -> pass/fail (MUST pass to proceed to approval)
5. Build      -> pass/fail (MUST pass to proceed to approval)
6. Diff Review (Sonnet worker) -> approved/concerns
```

### Output

Each step produces structured output included in the approval payload.
See `ValidationResult` in Section 5.

### Diff Review Worker

After automated validation, a Sonnet-level Cowork worker reviews the actual diff:
- Checks for correctness beyond what tests cover
- Identifies potential edge cases the tests miss
- Flags style inconsistencies with the existing codebase
- Checks for accidental debug code, console.logs, TODOs
- Verifies the fix actually addresses the reported issue

---

## 12. Failure Handling and Retry Behavior

### API Failures

| Failure | Retry? | Strategy |
|---------|--------|----------|
| Claude API 429 (rate limit) | Yes, 3x | Exponential backoff: 1s, 4s, 16s |
| Claude API 500/502/503 | Yes, 2x | Linear backoff: 2s, 5s |
| Claude API 400 (bad request) | No | Log error, fail worker |
| Claude API overloaded | Yes, 2x | 10s backoff |
| Context window overflow | No | Fail worker, note in audit |
| Network timeout (30s) | Yes, 2x | 5s backoff |

### Worker Failures

| Failure | Behavior |
|---------|----------|
| Single Cowork worker times out | Mark `timed_out`, continue with others |
| Single Cowork worker errors | Mark `failed`, continue with others |
| Claude Code worker fails on first attempt | Retry once with same context |
| Claude Code worker fails on retry | Fail task, report all errors |
| All Cowork workers fail | Proceed with Claude Code result only, flag reduced confidence |
| Claude Code + all workers fail | Fail task, report errors to Brain Link |

### Tool Execution Failures

| Failure | Behavior |
|---------|----------|
| File not found | Return error string to worker (worker adapts) |
| Command timeout (> 30s default) | Kill process, return timeout error |
| Command exits non-zero | Return stderr + exit code to worker |
| Path blocked by security | Return "access denied", log in audit |
| Worktree creation fails | Fail task immediately |
| Disk space insufficient | Fail task, alert via Brain Link |

### Validation Failures

| Failure | Behavior |
|---------|----------|
| Tests fail | Task moves to `awaiting_approval` with `validation.overallPass: false` |
| Lint errors | Same — included in approval payload |
| Build fails | Same — included in approval payload |
| Diff review raises critical concern | Flagged in approval payload |

Note: Validation failure does NOT auto-reject. Moe sees the failures and decides.

### State Recovery

- All task state persisted to `data/tasks/{taskId}.json` after each state change
- If gateway crashes mid-task, on restart it reads persisted state and resumes
- Worktrees survive gateway restart (they are on-disk git worktrees)
- In-flight API calls are lost on crash — gateway retries the current phase

---

## 13. Concrete Implementation Plan

### Prerequisites

- Node.js 24.x (installed)
- pnpm (installed)
- git 2.52.x (installed)
- Anthropic API key (have it)
- Cloudflare Tunnel (running)

### Step-by-Step Build Order

Each step is independently testable. A step is not started until the previous step works.

#### Step 1: Project Scaffold

- `pnpm init`, install TypeScript, ESLint, Vitest
- Set up tsconfig.json (strict mode, ESM, path aliases)
- Install: `express`, `ws`, `@anthropic-ai/sdk`, `zod`, `pino`, `minimatch`
- Create .env.example, .gitignore
- Create folder structure (see Section 14)
- **Verify**: `pnpm build` compiles without errors

#### Step 2: Config Layer

- `config/repos.json` with Solar Service OS and Modex entries
- `src/config/repos.ts` — load, validate with Zod
- `src/config/commands.ts` — allowlist/blocklist definitions
- `src/config/settings.ts` — port, timeouts, models, API keys from env
- **Verify**: unit tests for config loading and validation

#### Step 3: Security Layer

- `src/security/auth.ts` — Express middleware, validates X-Gateway-Key
- `src/security/path-guard.ts` — `validatePath()` with all checks
- `src/security/command-guard.ts` — `validateCommand()` with allowlist + blocklist
- **Verify**: unit tests covering path traversal, blocked files, blocked commands, allowed commands

#### Step 4: Audit Logger

- `src/audit/logger.ts` — pino-based JSONL logger
- Writes to `logs/audit-YYYY-MM-DD.jsonl`
- Exports `auditLog(taskId, action, actor, details)` function
- **Verify**: unit test confirms log entries written correctly

#### Step 5: Tool Executor

- `src/tools/file-ops.ts` — `readFile()`, `listDirectory()`, `searchContent()`
- `src/tools/git-ops.ts` — `gitLog()`, `gitDiff()`, `gitBlame()`, `gitStatus()`
- `src/tools/shell-ops.ts` — `execCommand()` with timeout, cwd, sandboxing
- `src/tools/executor.ts` — dispatcher: receives tool name + args, calls correct handler
- `src/tools/definitions.ts` — tool schemas (for Claude API)
- All operations go through path-guard and command-guard
- All operations are audit-logged
- **Verify**: integration tests against a real test git repo

#### Step 6: Workspace Manager

- `src/workspace/worktree.ts` — `createWorktree()`, `removeWorktree()`, `listWorktrees()`, `cleanStale()`
- `src/workspace/branch.ts` — `generateBranchName()`, slug generation
- Worktree creation validates: repo approved, under limit, disk space available
- **Verify**: integration tests creating and removing real worktrees

#### Step 7: Claude Code Worker

- `src/workers/claude-code.ts` — main analysis function
- `src/workers/prompts/claude-code.ts` — system prompt template
- Implements tool call loop: send message -> handle tool_use -> execute tools -> send results -> repeat
- Extracts structured JSON from final response
- **Verify**: integration test with real Claude API call against test repo

#### Step 8: Cowork Dispatcher

- `src/workers/cowork-dispatch.ts` — `dispatchCoworkWorkers()`
- `src/workers/prompts/reproduce.ts`, `root-cause.ts`, `risk.ts`, `test-gen.ts`, `review.ts`
- Each worker runs as independent Claude API conversation
- Promise.allSettled for parallel execution
- Timeout handling per worker
- **Verify**: integration test dispatching 3 workers in parallel

#### Step 9: Synthesis Engine

- `src/workers/synthesis.ts` — `synthesizeResults()`
- Merges Claude Code diagnosis with Cowork worker findings
- Computes agreement score: fraction of workers whose root cause keywords overlap with the Claude Code diagnosis (using keyword extraction + Jaccard similarity, threshold 0.3)
- Conflicts: listed when workers identify different affected files or contradictory root causes. When workers disagree on root cause, all root causes are included and recommendation is set to `needs_review`
- Recommendation logic: `proceed` if agreement > 0.6 AND Claude Code confidence > 0.7; `needs_review` if agreement < 0.6 OR any worker raised a critical concern; `insufficient_data` if Claude Code failed or < 2 workers completed
- Outputs unified Synthesis object
- **Verify**: unit tests with mock worker results covering agree/disagree/partial scenarios

#### Step 10: Validation Runner

- `src/validation/detector.ts` — auto-detect test/lint/build commands
- `src/validation/runner.ts` — run pipeline sequentially in worktree
- Captures structured output (pass/fail counts, durations)
- **Verify**: integration test running npm test in a test repo worktree

#### Step 11: Approval Manager

- `src/approval/queue.ts` — TaskState state machine, persist to `data/tasks/`
- `src/approval/actions.ts` — `applyPatch()`, `commitChanges()`, `pushBranch()`, `openPR()`
- Timeout handling (1 hour default)
- Rollback functions: `rollbackWorktree()`, `rollbackCommit()`
- **Verify**: unit tests for state transitions, integration test for commit flow

#### Step 12: API Layer

- `src/api/router.ts` — Express routes for all endpoints
- `src/api/websocket.ts` — WS connection handler, subscription management
- `src/api/middleware.ts` — auth, error handling, request ID, request logging
- Zod validation on all request bodies
- **Verify**: API tests with supertest

#### Step 13: Entry Point

- `src/index.ts` — starts Express + WS server, loads config, starts stale cleanup interval
- Graceful shutdown handling
- **Verify**: server starts, health endpoint returns OK

#### Step 14: Brain Link Integration

- Add `code_task` tool to Brain Link's TOOL_DEFINITIONS
- Add WebSocket client to Brain Link for streaming progress
- Add approval UI: show diagnosis, diff, test results, approve/reject buttons
- Send task via gateway REST API, stream progress via WS
- **Verify**: end-to-end test from Brain Link to gateway and back

#### Step 15: Cloudflare Tunnel

- Add route: `brainlink.lock28.com -> localhost:7400`
- Update cloudflared config
- Test connectivity from phone
- **Verify**: Brain Link on phone can reach gateway

#### Step 16: End-to-End Testing

- Create test repo with a known bug
- Run full workflow: intake -> investigate -> patch -> validate -> approve -> apply
- Test rollback flow
- Test failure scenarios (bad code, failing tests, timeout)
- Test concurrent tasks
- **Verify**: all flows complete successfully

---

## 14. Folder Structure

```
brainlink-local-agent/
|-- package.json
|-- tsconfig.json
|-- vitest.config.ts
|-- .env.example
|-- .env                         # API keys, gateway secret
|-- .gitignore
|-- config/
|   +-- repos.json               # Approved repository registry
|-- src/
|   |-- index.ts                 # Entry: Express + WS server
|   |-- pipeline.ts              # Task pipeline orchestrator
|   |-- config/
|   |   |-- repos.ts             # Load & validate repos.json
|   |   |-- commands.ts          # Command allowlist/blocklist
|   |   +-- settings.ts          # Port, timeouts, models, env
|   |-- api/
|   |   |-- router.ts            # Express route definitions
|   |   |-- websocket.ts         # WebSocket handler
|   |   +-- middleware.ts        # Auth, error handling, logging
|   |-- security/
|   |   |-- auth.ts              # API key validation middleware
|   |   |-- path-guard.ts        # File path validation
|   |   +-- command-guard.ts     # Shell command validation
|   |-- workspace/
|   |   |-- worktree.ts          # Git worktree lifecycle
|   |   +-- branch.ts            # Branch naming
|   |-- tools/
|   |   |-- definitions.ts       # Tool schemas for Claude API
|   |   |-- executor.ts          # Tool call dispatcher
|   |   |-- file-ops.ts          # read_file, list_dir, search
|   |   |-- git-ops.ts           # log, diff, blame, status
|   |   +-- shell-ops.ts         # Sandboxed command execution
|   |-- workers/
|   |   |-- claude-code.ts       # Main analysis worker
|   |   |-- cowork-dispatch.ts   # Parallel worker orchestrator
|   |   |-- synthesis.ts         # Merge worker results
|   |   +-- prompts/
|   |       |-- claude-code.ts
|   |       |-- reproduce.ts
|   |       |-- root-cause.ts
|   |       |-- test-gen.ts
|   |       |-- review.ts
|   |       +-- risk.ts
|   |-- validation/
|   |   |-- detector.ts          # Auto-detect test/lint/build
|   |   +-- runner.ts            # Run validation pipeline
|   |-- approval/
|   |   |-- queue.ts             # State machine + persistence
|   |   +-- actions.ts           # Apply, commit, push, PR
|   |-- audit/
|   |   +-- logger.ts            # JSONL audit logging
|   +-- types/
|       |-- task.ts              # TaskState, TaskRequest
|       |-- worker.ts            # WorkerResult, WorkerSpec
|       |-- tools.ts             # ToolCall, ToolResult
|       +-- api.ts               # API req/res types
|-- data/
|   +-- tasks/                   # Persisted task state JSON
|-- logs/
|   +-- (audit-YYYY-MM-DD.jsonl) # Generated at runtime
+-- test/
    |-- security/
    |   |-- path-guard.test.ts
    |   +-- command-guard.test.ts
    |-- tools/
    |   |-- file-ops.test.ts
    |   +-- git-ops.test.ts
    |-- workers/
    |   +-- synthesis.test.ts
    +-- e2e/
        +-- full-workflow.test.ts
```

---

## 15. MVP-to-Production Checklist (Cowork included from day 1)

### MVP — Week 1-2 (fully operational single-task flow)

- [ ] Gateway scaffold: Express + WS + TypeScript + pino + vitest
- [ ] Config: repos.json with Solar Service OS + Modex, settings from .env
- [ ] Security: auth middleware, path guard, command guard with tests
- [ ] Audit: JSONL logger for all actions
- [ ] Tool executor: file-ops, git-ops, shell-ops with security integration
- [ ] Workspace: worktree create/remove, branch naming, limit enforcement
- [ ] Claude Code worker: Sonnet API with tool loop, structured output
- [ ] Cowork dispatcher: 3 worker types (reproduce, root-cause, risk)
- [ ] Synthesis: merge worker results, compute confidence
- [ ] Validation: auto-detect and run test + lint pipeline
- [ ] Approval: state machine, apply + commit actions, rollback
- [ ] API: POST /tasks, GET /tasks/:id, POST /tasks/:id/approve, GET /health
- [ ] WebSocket: task progress streaming to Brain Link
- [ ] Brain Link: code_task tool + approval UI + WS client
- [ ] Cloudflare Tunnel: brainlink.lock28.com -> localhost:7400
- [ ] E2E test: diagnose + fix + validate + approve on real repo

### Hardening — Week 3

- [ ] Add remaining workers: test-gen, review (diff review)
- [ ] Model escalation: Sonnet -> Opus when confidence < 0.7
- [ ] Retry logic with exponential backoff for API failures
- [ ] Worker timeout handling (60s default, configurable)
- [ ] Stale worktree cleanup (24h interval)
- [ ] Task state persistence (survive gateway restart)
- [ ] Concurrent task support (multiple active worktrees)
- [ ] Rate limiting on gateway API
- [ ] Audit log rotation (daily files, 30-day retention)
- [ ] PR creation action (via `gh` CLI)
- [ ] Rollback flow: git revert, close PR

### Polish — Week 4

- [ ] Brain Link voice approval ("approve" / "reject" via speech recognition)
- [ ] Task history view in Brain Link
- [ ] Confidence-based routing (high confidence = skip some workers)
- [ ] Worker result caching (skip re-analysis of unchanged files)
- [ ] Metrics tracking: task duration, API costs, success rate
- [ ] Alert on failed tasks (Brain Link push notification)
- [ ] Multi-repo investigation (cross-repo tasks)
- [ ] Command learning (suggest new commands for allowlist based on repo)
