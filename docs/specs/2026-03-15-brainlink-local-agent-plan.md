# Brain Link Local Agent Gateway — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js gateway service that sits between Brain Link (mobile) and local code repositories, orchestrating Claude API workers for code diagnosis, fix generation, validation, and human-approved apply/commit/PR.

**Architecture:** Express + WebSocket server on port 7400. Claude API calls with tool definitions replace direct filesystem access. Workers (Claude Code + parallel Cowork) operate through the gateway's tool executor which enforces path/command security. All mutations require human approval via Brain Link.

**Tech Stack:** Node.js 24, TypeScript (strict, ESM), Express, ws, @anthropic-ai/sdk, Zod, pino, minimatch, Vitest

**Spec:** `docs/specs/2026-03-15-brainlink-local-agent-design.md`

---

## Chunk 1: Foundation (Scaffold, Config, Security, Audit)

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `src/index.ts` (placeholder)

- [ ] **Step 1: Initialize project**

```bash
cd C:/Users/Dell/Desktop/brainlink-local-agent
pnpm init
```

- [ ] **Step 2: Install dependencies**

```bash
pnpm add express ws @anthropic-ai/sdk zod pino pino-pretty minimatch
pnpm add -D typescript @types/express @types/ws @types/node vitest tsx
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 30000,
  },
});
```

- [ ] **Step 5: Create .env.example**

```
ANTHROPIC_API_KEY=sk-ant-...
GATEWAY_SECRET=your-gateway-secret-here
GATEWAY_PORT=7400
LOG_LEVEL=info
```

- [ ] **Step 6: Create .gitignore**

```
node_modules/
dist/
.env
logs/
data/tasks/
.worktrees/
*.tsbuildinfo
```

- [ ] **Step 7: Add scripts to package.json**

Add `"type": "module"` and these scripts:

```json
{
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 8: Create placeholder entry point**

Create `src/index.ts`:

```typescript
console.log('Brain Link Local Agent Gateway starting...');
```

- [ ] **Step 9: Create directory structure**

```bash
mkdir -p src/{config,api,security,workspace,tools,workers/prompts,validation,approval,audit,types}
mkdir -p config data/tasks logs test/{security,tools,workers,e2e}
```

- [ ] **Step 10: Verify build**

```bash
pnpm build
```

Expected: Compiles with no errors, creates `dist/index.js`.

- [ ] **Step 11: Commit**

```bash
git init && git add -A && git commit -m "feat: project scaffold with TypeScript, Express, Vitest"
```

---

### Task 2: Type Definitions

**Files:**
- Create: `src/types/task.ts`
- Create: `src/types/worker.ts`
- Create: `src/types/tools.ts`
- Create: `src/types/api.ts`

- [ ] **Step 1: Create src/types/task.ts**

All task-related types: `TaskStatus`, `TaskRequest`, `Diagnosis`, `PatchFile`, `Patch`, `DiffConcern`, `ValidationResult`, `ApprovalAction`, `ApprovalRecord`, `Synthesis`, `AuditAction`, `AuditEntry`, `TaskState`. See spec Section 5 for exact shapes.

- [ ] **Step 2: Create src/types/worker.ts**

All worker types: `WorkerType`, `WorkerResult`, `WorkerSpec`, `ToolDefinition`, `CoworkDispatch`, `ReproduceResult`, `RootCauseResult`, `TestGenResult`, `ReviewResult`, `RiskResult`. See spec Section 7.

- [ ] **Step 3: Create src/types/tools.ts**

`ToolCall` and `ToolResult` interfaces.

- [ ] **Step 4: Create src/types/api.ts**

`CreateTaskResponse`, `ApproveRequest`, `HealthResponse`, `WSMessage`.

- [ ] **Step 5: Verify build**

```bash
pnpm build
```

- [ ] **Step 6: Commit**

```bash
git add src/types/ && git commit -m "feat: add TypeScript type definitions for all domain objects"
```

---

### Task 3: Config Layer

**Files:**
- Create: `config/repos.json`
- Create: `src/config/settings.ts`
- Create: `src/config/repos.ts`
- Create: `src/config/commands.ts`
- Test: `test/config/repos.test.ts`

- [ ] **Step 1: Write failing test for config loading**

Create `test/config/repos.test.ts` with tests for: loads valid config, validates required fields, rejects invalid config path.

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- test/config/repos.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create config/repos.json**

```json
{
  "solar-service-os": {
    "path": "C:/Users/Dell/Desktop/Solar Service OS",
    "defaultBranch": "main",
    "allowedCommands": ["npm test", "npm run lint", "npm run build", "npx tsc --noEmit"],
    "blockedPaths": [".env", ".env.local", "*.pem", "*.key"],
    "maxWorktrees": 3
  },
  "modex": {
    "path": "C:/Users/Dell/Desktop/modex",
    "defaultBranch": "master",
    "allowedCommands": ["npm test", "npm run lint", "npm run build"],
    "blockedPaths": [".env", "desktop/scripts/*.key"],
    "maxWorktrees": 2
  }
}
```

- [ ] **Step 4: Create src/config/settings.ts**

Zod-validated settings loaded from env: `anthropicApiKey`, `gatewaySecret`, `port`, `logLevel`, `workerTimeoutMs`, `commandTimeoutMs`, `maxToolLoops`, `maxFileReadLines`, `maxSearchResults`, `maxToolResultChars`, `approvalTimeoutMs`, `staleWorktreeMs`, `minDiskSpaceMb`, `models` (claudeCode, claudeCodeEscalation, coworkInvestigation, coworkReview).

- [ ] **Step 5: Create src/config/repos.ts**

Zod-validated repo config loader: `loadRepoConfig()`, `getRepoConfig()`, `normalizePath()`.

- [ ] **Step 6: Create src/config/commands.ts**

`GLOBAL_ALLOWED_COMMANDS` array of regex patterns for read-only git commands. `COMMAND_BLOCKLIST` array of regex patterns for dangerous commands. See spec Section 9.

- [ ] **Step 7: Run tests**

```bash
pnpm test -- test/config/repos.test.ts
```

Expected: All PASS.

- [ ] **Step 8: Commit**

```bash
git add config/ src/config/ test/config/ && git commit -m "feat: add config layer with Zod-validated repos and settings"
```

---

### Task 4: Security Layer

**Files:**
- Create: `src/security/auth.ts`
- Create: `src/security/path-guard.ts`
- Create: `src/security/command-guard.ts`
- Test: `test/security/path-guard.test.ts`
- Test: `test/security/command-guard.test.ts`

- [ ] **Step 1: Write path-guard tests**

Tests for: allows valid paths, blocks `..` traversal, blocks `.env` files (exact), blocks `.env.local` and `.env.production` (wildcard `.env*`), blocks `*.pem` via glob, blocks global sensitive patterns (`.git/config`, `*.key`, `*credentials*`), allows normal source files (`src/App.tsx`, `package.json`).

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- test/security/path-guard.test.ts
```

- [ ] **Step 3: Implement src/security/path-guard.ts**

`validatePath(requestedPath, repoConfig, worktreePath?)` — resolves path, checks it starts with base, checks against global + repo blocked patterns using minimatch. Throws `SecurityError` on violation. See spec Section 9 for exact logic.

- [ ] **Step 4: Run path-guard tests**

Expected: All PASS.

- [ ] **Step 5: Write command-guard tests**

Tests for: allows repo commands, allows global git read commands, blocks unknown commands, blocks dangerous commands even if allowlisted, blocks command substitution (`$(...)`, backticks).

- [ ] **Step 6: Implement src/security/command-guard.ts**

`validateCommand(command, repoAllowedCommands)` — checks blocklist first (defense in depth), then checks global + repo allowlists. Throws `CommandBlockedError` if not allowed. See spec Section 9.

- [ ] **Step 7: Run command-guard tests**

Expected: All PASS.

- [ ] **Step 8: Create src/security/auth.ts**

Express middleware that checks `X-Gateway-Key` header against `settings.gatewaySecret`. Returns 401 if invalid.

- [ ] **Step 9: Run all security tests**

```bash
pnpm test
```

- [ ] **Step 10: Commit**

```bash
git add src/security/ test/security/ && git commit -m "feat: add security layer — path guard, command guard, auth middleware"
```

---

### Task 5: Audit Logger

**Files:**
- Create: `src/audit/logger.ts`
- Test: `test/audit/logger.test.ts`

- [ ] **Step 1: Write audit logger test**

Tests for: writes structured JSONL entries, appends multiple entries to same file, entries have correct fields (timestamp, taskId, action, actor, details).

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement src/audit/logger.ts**

`AuditLogger` class with `log(taskId, action, actor, details)` method. Writes to `logs/audit-YYYY-MM-DD.jsonl`. One JSON object per line. Creates logs directory on init.

- [ ] **Step 4: Run tests**

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/audit/ test/audit/ && git commit -m "feat: add JSONL audit logger"
```

---

## Chunk 2: Tool Executor and Workspace Manager

### Task 6: File Operations

**Files:**
- Create: `src/tools/file-ops.ts`
- Test: `test/tools/file-ops.test.ts`

- [ ] **Step 1: Write file-ops tests**

Create temp directory with test files. Tests for `readFileTool`: reads with line numbers, supports start/end line, error for missing file. Tests for `listDirectoryTool`: lists entries. Tests for `searchContentTool`: finds matches, returns "No matches" for no results.

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement src/tools/file-ops.ts**

`readFileTool(basePath, filePath, startLine?, endLine?)` — reads file, adds line numbers, truncates at 500 lines with warning. `listDirectoryTool(basePath, dirPath, recursive?, pattern?)` — lists directory contents. `searchContentTool(basePath, pattern, searchPath?, filePattern?, contextLines?)` — uses `rg` (ripgrep) for regex search, max 20 results, truncates at 8000 chars.

Note: use `child_process.execFileSync` instead of `exec` for shell commands to avoid injection. For ripgrep, pass arguments as an array.

- [ ] **Step 4: Run tests**

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/file-ops.ts test/tools/file-ops.test.ts && git commit -m "feat: add file operations — read, list, search"
```

---

### Task 7: Git Operations

**Files:**
- Create: `src/tools/git-ops.ts`
- Test: `test/tools/git-ops.test.ts`

- [ ] **Step 1: Write git-ops tests**

Create temp git repo with commits. Tests for `gitLogTool`: returns history, respects count limit. Tests for `gitDiffTool`: shows diff between refs. Tests for `gitStatusTool`: shows clean status.

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement src/tools/git-ops.ts**

`gitLogTool`, `gitDiffTool`, `gitBlameTool`, `gitStatusTool` — each runs git commands via `execFileSync('git', [...args], { cwd })`, truncates output at 8000 chars. Returns `ToolResult`.

Note: use `execFileSync` with argument arrays, NOT `exec` with string concatenation.

- [ ] **Step 4: Run tests**

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/git-ops.ts test/tools/git-ops.test.ts && git commit -m "feat: add git operations — log, diff, blame, status"
```

---

### Task 8: Shell Operations

**Files:**
- Create: `src/tools/shell-ops.ts`
- Test: `test/tools/shell-ops.test.ts`

- [ ] **Step 1: Write shell-ops tests**

Create `test/tools/shell-ops.test.ts` with tests for: successful command returns output, timeout kills process and returns error, captures stderr on non-zero exit, output truncated at 8000 chars.

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm test -- test/tools/shell-ops.test.ts
```

- [ ] **Step 3: Implement src/tools/shell-ops.ts**

`execCommandTool(command, cwd, timeoutMs?)` — executes a shell command with configurable timeout (default 30s, max 120s). Captures stdout + stderr. Returns `ToolResult` with success/failure, truncated output, and error info. Kills process on timeout.

Security note: runs pre-validated commands (already passed through command-guard).

- [ ] **Step 4: Run tests**

```bash
pnpm test -- test/tools/shell-ops.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/shell-ops.ts test/tools/shell-ops.test.ts && git commit -m "feat: add sandboxed shell command executor"
```

---

### Task 9: Tool Executor (dispatcher)

**Files:**
- Create: `src/tools/definitions.ts`
- Create: `src/tools/executor.ts`

- [ ] **Step 1: Create src/tools/definitions.ts**

Export tool definition arrays matching spec Section 6:
- `READ_ONLY_TOOLS`: read_file, list_directory, search_content, git_log, git_diff, git_blame
- `WRITE_TOOLS`: write_file
- `COMMAND_TOOL`: run_command
- `CLAUDE_CODE_TOOLS`: all of the above combined
- `COWORK_READ_TOOLS`: read-only subset only

- [ ] **Step 2: Create src/tools/executor.ts**

`executeTool(toolName, input, ctx: ExecutorContext)` — dispatcher that:
1. Matches tool name to handler (read_file -> readFileTool, etc.)
2. Validates paths via path-guard before file operations
3. Validates commands via command-guard before shell operations
4. Enforces read-only mode for Cowork workers (rejects write_file)
5. Logs every operation to audit logger
6. Catches SecurityError and CommandBlockedError, returns structured error to worker

`ExecutorContext` contains: taskId, worktreePath, repoConfig, audit logger, actor identity, readOnly flag.

- [ ] **Step 3: Write executor tests**

Create `test/tools/executor.test.ts` with tests for: dispatches `read_file` to correct handler, enforces `readOnly` mode (rejects `write_file` for read-only context), calls path-guard before file ops (blocked path returns structured error not crash), calls command-guard before shell ops, logs to audit on every tool execution.

- [ ] **Step 4: Run executor tests**

```bash
pnpm test -- test/tools/executor.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/definitions.ts src/tools/executor.ts test/tools/executor.test.ts && git commit -m "feat: add tool executor with security-integrated dispatch"
```

---

### Task 10: Workspace Manager

**Files:**
- Create: `src/workspace/branch.ts`
- Create: `src/workspace/worktree.ts`

- [ ] **Step 1: Create src/workspace/branch.ts**

`generateTaskId()` — returns `task_` + 5-char random base36. `generateSlug(description, maxLength=40)` — lowercase, strip special chars, take first 4 words, kebab-case. `generateBranchName(taskId, description)` — returns `brainlink/{taskId}/{slug}`.

- [ ] **Step 2: Create src/workspace/worktree.ts**

`createWorktree(repoPath, taskId, description, sourceBranch, audit)` — runs `git worktree add`, returns `WorktreeInfo`. `removeWorktree(repoPath, taskId, branch, audit)` — runs `git worktree remove --force`, deletes branch, retries on Windows file locking. `listWorktrees(repoPath)` — parses `git worktree list --porcelain`.

Use `execFileSync('git', [...args], { cwd })` for all git commands.

Important: `createWorktree` must enforce worktree limits — call `listWorktrees`, count active worktrees for the repo, reject if `>= maxWorktrees`. Also check disk space against `settings.minDiskSpaceMb` before creating.

- [ ] **Step 3: Write workspace tests**

Create `test/workspace/worktree.test.ts` with tests for: creates worktree (directory exists), removes worktree, `generateBranchName` produces correct format, `generateSlug` truncates at max length, `listWorktrees` returns expected entries. Use a temp git repo.

- [ ] **Step 4: Run tests**

```bash
pnpm test -- test/workspace/worktree.test.ts
```

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workspace/ test/workspace/ && git commit -m "feat: add workspace manager — worktree lifecycle, branch naming"
```

---

## Chunk 3: Workers and Orchestration

### Task 11: Worker Prompts

**Files:**
- Create: `src/workers/prompts/claude-code.ts`
- Create: `src/workers/prompts/reproduce.ts`
- Create: `src/workers/prompts/root-cause.ts`
- Create: `src/workers/prompts/risk.ts`
- Create: `src/workers/prompts/review.ts`
- Create: `src/workers/prompts/test-gen.ts`

- [ ] **Step 1: Create all 6 prompt builder functions**

Each exports a `build*Prompt(...)` function that takes context parameters and returns a system prompt string. Prompts instruct the worker to use tools, analyze code, and return structured JSON. See spec Section 7 for worker responsibilities and return schemas.

Note: The `review` worker type (spec Section 7) and `diff-review` (spec Section 11) are the **same worker** — a Sonnet-level reviewer that takes a diff as input. Use `review` as the canonical worker type. Remove `diff-review` from the `WorkerType` union in Task 2's `src/types/worker.ts`, and map the validation phase's diff review to the `review` worker type.

- [ ] **Step 2: Verify build**

```bash
pnpm build
```

- [ ] **Step 3: Commit**

```bash
git add src/workers/prompts/ && git commit -m "feat: add worker system prompts for all 6 worker types"
```

---

### Task 12: Claude Code Worker

**Files:**
- Create: `src/workers/claude-code.ts`

- [ ] **Step 1: Implement Claude Code worker**

`runClaudeCodeWorker(taskId, ctx, issue, repoName, branchName, focusFiles, onProgress?)`:

1. Creates Anthropic client from settings
2. Builds system prompt via `buildClaudeCodePrompt`
3. Runs tool call loop (spec Section 6):
   - Send message with CLAUDE_CODE_TOOLS
   - If `stop_reason === 'tool_use'`: execute tools via executor, send results back
   - If `stop_reason === 'end_turn'`: extract JSON from response
   - Max 20 loops
4. Tracks token usage, duration
5. Returns `WorkerResult` with diagnosis + patch
6. On failure: logs to audit, returns failed result

- [ ] **Step 2: Verify build**

```bash
pnpm build
```

- [ ] **Step 3: Commit**

```bash
git add src/workers/claude-code.ts && git commit -m "feat: add Claude Code worker with tool loop and JSON extraction"
```

---

### Task 13: Cowork Dispatcher

**Files:**
- Create: `src/workers/cowork-dispatch.ts`

- [ ] **Step 1: Implement Cowork dispatcher**

Two dispatch functions:

`dispatchInvestigationWorkers(taskId, issue, ctx, onProgress?)` — creates and runs 3 workers in parallel (reproduce, root-cause, risk) using Promise.allSettled.

`dispatchValidationWorkers(taskId, issue, diff, patchDescription, ctx, onProgress?)` — creates and runs 2 workers (review, test-gen).

Internal `runSingleWorker(taskId, job, ctx, timeoutMs, onProgress?)` — runs one worker:
1. Creates Anthropic client
2. Runs tool loop with COWORK_READ_TOOLS (read-only)
3. Enforces timeout via Promise.race
4. Extracts JSON from final response
5. Returns WorkerResult

All Cowork workers use `readOnly: true` in ExecutorContext.

- [ ] **Step 2: Verify build**

```bash
pnpm build
```

- [ ] **Step 3: Commit**

```bash
git add src/workers/cowork-dispatch.ts && git commit -m "feat: add Cowork parallel worker dispatcher"
```

---

### Task 14: Synthesis Engine

**Files:**
- Create: `src/workers/synthesis.ts`
- Test: `test/workers/synthesis.test.ts`

- [ ] **Step 1: Write synthesis test**

Tests for: `proceed` when workers agree (agreement > 0.6, confidence > 0.7), `needs_review` when workers disagree, `insufficient_data` when Claude Code failed or <2 workers completed.

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement src/workers/synthesis.ts**

`synthesizeResults(claudeCodeResult, coworkResults)`:
1. Extract diagnosis from Claude Code result
2. Compute agreement score using keyword overlap (Jaccard similarity > 0.2 threshold)
3. Collect conflicts where workers identify different root causes
4. Collect additional issues from risk worker
5. Determine recommendation: `proceed` if agreement > 0.6 AND confidence > 0.7; `needs_review` if agreement < 0.6 OR conflicts exist; `insufficient_data` if Claude Code failed or <2 workers completed
6. Return Synthesis object

- [ ] **Step 4: Run tests**

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add src/workers/synthesis.ts test/workers/synthesis.test.ts && git commit -m "feat: add synthesis engine with agreement scoring"
```

---

## Chunk 4: Validation, Approval, API, and Entry Point

### Task 15: Validation Runner

**Files:**
- Create: `src/validation/detector.ts`
- Create: `src/validation/runner.ts`

- [ ] **Step 1: Implement src/validation/detector.ts**

`detectValidation(worktreePath)` — reads `package.json`, checks for test/lint/build/typecheck scripts, checks for eslint config files (`.eslintrc`, `.eslintrc.js`, `.eslintrc.json`, `.eslintrc.yml`, `eslint.config.js`, `eslint.config.mjs`), checks for `tsconfig.json`. Returns `{ test, lint, build, typecheck }` with null for unavailable commands.

- [ ] **Step 2: Implement src/validation/runner.ts**

`runValidation(worktreePath, repoConfig, audit, taskId)`:
1. **Install dependencies if needed**: check if `node_modules/` exists in worktree. If not, or if the patch modified `package.json`/`package-lock.json`, run `pnpm install` (preferred) or `npm install` in the worktree. This is critical — tests/lint/build cannot run without dependencies.
2. Call `detectValidation` to find available commands
3. Run each in sequence: typecheck -> lint -> test -> build
4. Each runs via `execCommandTool` in the worktree
5. Parse output for pass/fail counts where possible
6. Return `ValidationResult`

- [ ] **Step 3: Verify build**

```bash
pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add src/validation/ && git commit -m "feat: add validation pipeline — auto-detect and run test/lint/build"
```

---

### Task 16: Approval Manager

**Files:**
- Create: `src/approval/queue.ts`
- Create: `src/approval/actions.ts`

- [ ] **Step 1: Implement src/approval/queue.ts**

`TaskStore` class:
- `create(taskId, request, worktreeInfo)` — creates TaskState, persists to `data/tasks/{taskId}.json`
- `get(taskId)` — reads from disk
- `update(taskId, updates)` — merges updates, persists, updates `updatedAt`
- `transition(taskId, newStatus)` — validates state machine transition per spec Section 8
- `list()` — returns all task states
- `listPending()` — returns tasks in `awaiting_approval`

State machine validation: only allows valid transitions (e.g., `pending` -> `investigating`, NOT `pending` -> `completed`).

Approval timeout: when a task enters `awaiting_approval`, record `expiresAt` (now + `settings.approvalTimeoutMs`). The stale cleanup interval in the entry point checks for expired approvals and transitions them to `expired`.

- [ ] **Step 2: Write approval tests**

Create `test/approval/queue.test.ts` with tests for: valid state transitions succeed, invalid transitions throw, persisted state survives round-trip read/write to disk, `listPending` returns only `awaiting_approval` tasks, expired tasks are detected correctly.

- [ ] **Step 3: Run tests**

```bash
pnpm test -- test/approval/queue.test.ts
```

Expected: All PASS.

- [ ] **Step 4: Implement src/approval/actions.ts**

`applyPatch(taskState)` — writes patch files to worktree using PatchFile data.
`commitChanges(repoPath, taskState, message?)` — stages changes, creates commit with audit metadata in message.
`pushBranch(repoPath, branch)` — runs `git push -u origin {branch}`.
`openPR(repoPath, taskState)` — runs `gh pr create` with title from diagnosis summary and body from synthesis.
`rollbackChanges(repoPath, taskState)` — implements rollback per spec Section 8 rollback procedure.

Use `execFileSync('git', [...args])` for git commands.

- [ ] **Step 3: Verify build**

```bash
pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add src/approval/ && git commit -m "feat: add approval manager with state machine and git actions"
```

---

### Task 17: API Layer

**Files:**
- Create: `src/api/router.ts`
- Create: `src/api/websocket.ts`
- Create: `src/api/middleware.ts`

- [ ] **Step 1: Create src/api/middleware.ts**

Re-export auth middleware. Add JSON error handler middleware. Add request ID generator middleware (sets `req.id` from header or UUID).

- [ ] **Step 2: Create src/api/router.ts**

Express router with endpoints per spec Section 4:

- `POST /api/tasks` — validates request body with Zod, creates task, creates worktree, launches investigation pipeline (Claude Code + Cowork workers), returns task ID. The investigation runs async — endpoint returns immediately.
- `GET /api/tasks/:id` — returns full TaskState from TaskStore
- `POST /api/tasks/:id/approve` — validates action, executes apply/commit/push/PR as requested, returns result
- `POST /api/tasks/:id/rollback` — calls rollbackChanges, updates status
- `GET /api/repos` — returns repo registry with active worktree counts
- `GET /api/audit` — reads audit log files, filters by query params
- `GET /api/health` — returns uptime, active worktrees, pending approvals

- [ ] **Step 3: Create src/api/websocket.ts**

WebSocket server on same HTTP server, path `/ws`:
- Auth: first message must be `{ type: "auth", key: "..." }`
- Subscribe: `{ type: "subscribe", taskId: "..." }`
- Sync: `{ type: "sync", taskIds: [...] }` — sends current state for each
- Replay: `{ type: "replay", taskId: "...", afterTimestamp: "..." }` — sends buffered events
- Server broadcasts: progress, worker_complete, synthesis_complete, validation_complete, approval_required, task_complete
- Ping/pong: server sends ping every 30s
- Event buffer: last 50 events per task (for replay)

Export a `broadcast(taskId, event)` function that the router/pipeline calls to push updates.

- [ ] **Step 4: Write API tests**

Create `test/api/router.test.ts` with tests using supertest (add `supertest` as dev dependency): health endpoint returns 200 with `status: "ok"`, unauthenticated request returns 401, POST /api/tasks with valid body returns taskId, GET /api/repos returns repo list.

- [ ] **Step 5: Run API tests**

```bash
pnpm test -- test/api/router.test.ts
```

Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add src/api/ test/api/ && git commit -m "feat: add REST API routes and WebSocket handler"
```

---

### Task 18: Entry Point and Task Pipeline

**Files:**
- Modify: `src/index.ts`
- Create: `src/pipeline.ts`

- [ ] **Step 1: Create src/pipeline.ts**

`runTaskPipeline(taskId, request, taskStore, repoConfig, audit, broadcast)`:

This is the async orchestration function that runs after a task is created:

1. Transition to `investigating`
2. Create ExecutorContext for the worktree
3. Launch Claude Code worker AND Cowork investigation workers in parallel (Promise.allSettled)
4. Broadcast progress events via WebSocket
5. Transition to `synthesizing`
6. Run synthesis engine on all worker results
7. If Claude Code generated a patch: apply patch to worktree, transition to `validating`
8. Run validation pipeline (test/lint/build)
9. Dispatch validation workers (review, test-gen)
10. Transition to `awaiting_approval`
11. Build approval payload, broadcast approval_required event
12. Wait for approval (polling TaskStore or event-driven)

On failure at any step: transition to `failed`, log error, broadcast failure event.

- [ ] **Step 2: Update src/index.ts**

Wire everything together:
1. Load dotenv
2. Load config and settings
3. Create Express app, AuditLogger, TaskStore
4. Mount middleware (auth, JSON parsing, error handler)
5. Mount API router
6. Create HTTP server
7. Attach WebSocket handler
8. Start listening on configured port
9. Set up stale worktree cleanup interval (check every hour, remove worktrees older than 24h based on `updatedAt`, also check for expired approvals)
10. **Startup recovery**: on boot, scan `data/tasks/` for tasks in non-terminal states (`investigating`, `synthesizing`, `validating`). Transition them to `failed` with reason "gateway restarted". This prevents zombie tasks.
11. Graceful shutdown: close server, clean up

**Deferred to hardening pass**: API retry logic with exponential backoff for Claude API 429/500 errors (spec Section 12). For MVP, failed API calls fail the worker immediately. Model escalation (Sonnet -> Opus on low confidence) also deferred.

- [ ] **Step 3: Verify server starts**

```bash
cp .env.example .env
# Edit .env with real keys
pnpm dev
```

Expected: Server starts, `GET /api/health` returns `{"status":"ok",...}`.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts src/pipeline.ts && git commit -m "feat: add entry point and task pipeline orchestrator"
```

---

## Chunk 5: Integration and Deployment

### Task 19: End-to-End Test

**Files:**
- Create: `test/e2e/full-workflow.test.ts`

- [ ] **Step 1: Write E2E test**

1. Create a temp git repo with a file containing a known bug (e.g., `function getUser(id) { return users[id].name; }` — missing null check)
2. Add it to repos config temporarily
3. Start the gateway server programmatically
4. POST /api/tasks with a fix request
5. Poll GET /api/tasks/:id until status reaches `awaiting_approval`
6. Verify: diagnosis exists, patch exists, validation ran
7. POST /api/tasks/:id/approve with `apply_and_commit`
8. Verify: status is `completed`, commit exists in repo
9. Cleanup: stop server, remove temp repo

- [ ] **Step 2: Run E2E test**

```bash
pnpm test -- test/e2e/full-workflow.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add test/e2e/ && git commit -m "test: add end-to-end workflow test"
```

---

### Task 20: Cloudflare Tunnel Setup

- [ ] **Step 1: Add brainlink.lock28.com tunnel route**

Add to cloudflared config: `brainlink.lock28.com -> http://localhost:7400`. Since `*.lock28.com` already resolves to `45.55.77.74`, and cloudflared is running, just add the ingress rule.

- [ ] **Step 2: Restart cloudflared**

- [ ] **Step 3: Verify connectivity**

```bash
curl -H "X-Gateway-Key: your-secret" https://brainlink.lock28.com/api/health
```

Expected: `{"status":"ok",...}`

---

### Task 21: Brain Link Integration

**Files:**
- Modify: `C:/Users/Dell/Desktop/brain-link-master/App.tsx`

- [ ] **Step 1: Add code_task tool definition**

Add to `TOOL_DEFINITIONS` in App.tsx:

```typescript
{
  name: 'code_task',
  description: 'Send a code task to the Local Agent Gateway. Use when Moe asks to diagnose, fix, investigate, test, or review code.',
  input_schema: {
    type: 'object' as const,
    properties: {
      type: { type: 'string', enum: ['diagnose', 'fix', 'investigate', 'test', 'review'] },
      repo: { type: 'string', description: 'Repository key (e.g., solar-service-os, modex)' },
      description: { type: 'string', description: 'What to do' },
      files: { type: 'array', items: { type: 'string' }, description: 'Optional focus files' },
    },
    required: ['type', 'repo', 'description'],
  },
}
```

- [ ] **Step 2: Add code_task handler in tool loop**

In the tool use handler, add:

```typescript
} else if (tool.name === 'code_task') {
  result = await sendCodeTask(tool.input);
}
```

- [ ] **Step 3: Implement sendCodeTask function**

```typescript
const GATEWAY_URL = process.env.EXPO_PUBLIC_GATEWAY_URL || 'https://brainlink.lock28.com';
const GATEWAY_KEY = process.env.EXPO_PUBLIC_GATEWAY_KEY || '';

async function sendCodeTask(input: any): Promise<string> {
  try {
    const res = await fetch(`${GATEWAY_URL}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Gateway-Key': GATEWAY_KEY },
      body: JSON.stringify({ type: input.type, repo: input.repo, description: input.description, files: input.files, priority: 'normal' }),
    });
    if (!res.ok) return `Gateway error: ${res.status}`;
    const data = await res.json();
    return `Task created: ${data.taskId}. Branch: ${data.worktreeBranch}. The gateway is analyzing the code. You will be notified when results are ready.`;
  } catch (err) { return 'Gateway unreachable: ' + (err instanceof Error ? err.message : ''); }
}
```

- [ ] **Step 4: Add env vars to Brain Link .env**

```
EXPO_PUBLIC_GATEWAY_URL=https://brainlink.lock28.com
EXPO_PUBLIC_GATEWAY_KEY=your-gateway-secret
```

- [ ] **Step 5: Rebuild and deploy Brain Link**

```bash
cd C:/Users/Dell/Desktop/brain-link-master
npx expo run:android
```

- [ ] **Step 6: Commit Brain Link changes**

```bash
git add App.tsx .env && git commit -m "feat: add code_task tool for Local Agent Gateway integration"
```

---

## Summary

| Chunk | Tasks | What it delivers |
|-------|-------|-----------------|
| 1: Foundation | 1-5 | Scaffold, types, config, security (path + command guards), audit logger — all TDD |
| 2: Tools & Workspace | 6-10 | File/git/shell operations, tool executor dispatcher, worktree manager — all TDD |
| 3: Workers | 11-14 | Worker prompts, Claude Code worker, Cowork parallel dispatcher, synthesis — TDD on synthesis |
| 4: API & Pipeline | 15-18 | Validation runner, approval state machine, REST + WS API, pipeline orchestrator |
| 5: Integration | 19-21 | E2E test, Cloudflare tunnel, Brain Link code_task tool |

**Total: 21 tasks, ~28 hours of focused engineering.**

Each chunk produces working, testable software. Chunks 1-2 are fully test-driven. Chunk 3 has TDD on synthesis, integration tests on workers. Chunk 4 follows the spec directly. Chunk 5 validates everything end-to-end.
