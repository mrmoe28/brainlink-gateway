import Anthropic from '@anthropic-ai/sdk';
import { executeTool, type ExecutorContext } from '../tools/executor.js';
import { COWORK_READ_TOOLS } from '../tools/definitions.js';
import { buildReproducePrompt } from './prompts/reproduce.js';
import { buildRootCausePrompt } from './prompts/root-cause.js';
import { buildRiskPrompt } from './prompts/risk.js';
import { buildReviewPrompt } from './prompts/review.js';
import { buildTestGenPrompt } from './prompts/test-gen.js';
import { loadSettings } from '../config/settings.js';
import type { WorkerResult, WorkerType, ToolDefinition } from '../types/worker.js';

interface WorkerJob {
  type: WorkerType;
  model: string;
  systemPrompt: string;
  tools: ToolDefinition[];
}

export async function dispatchInvestigationWorkers(
  taskId: string,
  issue: string,
  ctx: ExecutorContext,
  onProgress?: (worker: string, msg: string) => void,
): Promise<WorkerResult[]> {
  const settings = loadSettings();
  const jobs: WorkerJob[] = [
    { type: 'reproduce', model: settings.models.coworkInvestigation, systemPrompt: buildReproducePrompt(issue), tools: COWORK_READ_TOOLS },
    { type: 'root-cause', model: settings.models.coworkInvestigation, systemPrompt: buildRootCausePrompt(issue), tools: COWORK_READ_TOOLS },
    { type: 'risk', model: settings.models.coworkInvestigation, systemPrompt: buildRiskPrompt(issue), tools: COWORK_READ_TOOLS },
  ];
  return runWorkersInParallel(taskId, jobs, ctx, settings.workerTimeoutMs, onProgress);
}

export async function dispatchValidationWorkers(
  taskId: string,
  issue: string,
  diff: string,
  patchDescription: string,
  ctx: ExecutorContext,
  onProgress?: (worker: string, msg: string) => void,
): Promise<WorkerResult[]> {
  const settings = loadSettings();
  const jobs: WorkerJob[] = [
    { type: 'review', model: settings.models.coworkReview, systemPrompt: buildReviewPrompt(issue, diff), tools: COWORK_READ_TOOLS },
    { type: 'test-gen', model: settings.models.coworkInvestigation, systemPrompt: buildTestGenPrompt(issue, patchDescription), tools: COWORK_READ_TOOLS },
  ];
  return runWorkersInParallel(taskId, jobs, ctx, settings.workerTimeoutMs, onProgress);
}

async function runWorkersInParallel(
  taskId: string,
  jobs: WorkerJob[],
  ctx: ExecutorContext,
  timeoutMs: number,
  onProgress?: (worker: string, msg: string) => void,
): Promise<WorkerResult[]> {
  const promises = jobs.map(job => runSingleWorker(taskId, job, ctx, timeoutMs, onProgress));
  const settled = await Promise.allSettled(promises);
  return settled.map((result, i) => {
    if (result.status === 'fulfilled') return result.value;
    return {
      workerId: `${taskId}_${jobs[i].type}`,
      workerType: jobs[i].type,
      status: 'failed' as const,
      model: jobs[i].model,
      result: null,
      tokensUsed: 0,
      durationMs: 0,
      error: result.reason?.message ?? 'Unknown error',
    };
  });
}

async function runSingleWorker(
  taskId: string,
  job: WorkerJob,
  ctx: ExecutorContext,
  timeoutMs: number,
  onProgress?: (worker: string, msg: string) => void,
): Promise<WorkerResult> {
  const settings = loadSettings();
  const client = new Anthropic({ apiKey: settings.anthropicApiKey });
  const startTime = Date.now();
  let totalTokens = 0;
  const readOnlyCtx: ExecutorContext = { ...ctx, readOnly: true, actor: 'cowork-worker' };

  ctx.audit.log(taskId, 'worker_started', 'gateway', { workerType: job.type, model: job.model });

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: 'Analyze the codebase and return your findings.' }];

  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(Object.assign(new Error('Worker timed out'), { name: 'TimeoutError' })), timeoutMs);
  });

  try {
    const workPromise = (async () => {
      let loopCount = 0;
      const maxLoops = 15;
      while (loopCount < maxLoops) {
        loopCount++;
        const response = await client.messages.create({
          model: job.model,
          max_tokens: 2048,
          system: job.systemPrompt,
          tools: job.tools as Anthropic.Tool[],
          messages,
        });
        totalTokens += (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

        if (response.stop_reason === 'end_turn') {
          const text = response.content
            .filter((b): b is Anthropic.TextBlock => b.type === 'text')
            .map(b => b.text)
            .join('');
          const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/) || text.match(/\{[\s\S]*\}/);
          return jsonMatch ? JSON.parse(jsonMatch[1] ?? jsonMatch[0]) : { raw: text };
        }

        if (response.stop_reason === 'tool_use') {
          const toolBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const tool of toolBlocks) {
            onProgress?.(job.type, `${tool.name}`);
            const result = await executeTool(tool.name, tool.input as Record<string, unknown>, readOnlyCtx);
            toolResults.push({ type: 'tool_result', tool_use_id: tool.id, content: result.success ? result.output : `ERROR: ${result.error}` });
          }
          messages.push({ role: 'assistant', content: response.content });
          messages.push({ role: 'user', content: toolResults });
        }
      }
      throw new Error('Max loops reached');
    })();

    const result = await Promise.race([workPromise, timeoutPromise]);
    ctx.audit.log(taskId, 'worker_completed', 'gateway', { workerType: job.type, tokensUsed: totalTokens });
    return {
      workerId: `${taskId}_${job.type}`,
      workerType: job.type,
      status: 'completed',
      model: job.model,
      result,
      tokensUsed: totalTokens,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'TimeoutError';
    ctx.audit.log(taskId, isTimeout ? 'worker_timed_out' : 'worker_failed', 'gateway', {
      workerType: job.type,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      workerId: `${taskId}_${job.type}`,
      workerType: job.type,
      status: isTimeout ? 'timed_out' : 'failed',
      model: job.model,
      result: null,
      tokensUsed: totalTokens,
      durationMs: Date.now() - startTime,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
