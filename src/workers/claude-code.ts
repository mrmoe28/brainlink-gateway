import Anthropic from '@anthropic-ai/sdk';
import { buildClaudeCodePrompt } from './prompts/claude-code.js';
import { CLAUDE_CODE_TOOLS } from '../tools/definitions.js';
import { executeTool, type ExecutorContext } from '../tools/executor.js';
import type { Diagnosis, Patch } from '../types/task.js';
import type { WorkerResult } from '../types/worker.js';
import { loadSettings } from '../config/settings.js';

interface ClaudeCodeOutput {
  diagnosis: Diagnosis;
  patch: Patch;
  additionalIssues: string[];
}

export async function runClaudeCodeWorker(
  taskId: string,
  ctx: ExecutorContext,
  issue: string,
  repoName: string,
  branchName: string,
  focusFiles: string[],
  onProgress?: (msg: string) => void,
): Promise<WorkerResult> {
  const settings = loadSettings();
  const client = new Anthropic({ apiKey: settings.anthropicApiKey });
  const startTime = Date.now();
  let totalTokens = 0;

  ctx.audit.log(taskId, 'worker_started', 'gateway', {
    workerType: 'claude-code',
    model: settings.models.claudeCode,
  });

  const systemPrompt = buildClaudeCodePrompt({ repoName, branchName, description: issue, focusFiles });
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: issue }];

  try {
    let loopCount = 0;
    while (loopCount < settings.maxToolLoops) {
      loopCount++;
      const response = await client.messages.create({
        model: settings.models.claudeCode,
        max_tokens: 4096,
        system: systemPrompt,
        tools: CLAUDE_CODE_TOOLS as Anthropic.Tool[],
        messages,
      });

      totalTokens += (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

      if (response.stop_reason === 'end_turn') {
        const textContent = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map(b => b.text)
          .join('');

        const result = extractJson<ClaudeCodeOutput>(textContent);

        ctx.audit.log(taskId, 'worker_completed', 'gateway', {
          workerType: 'claude-code',
          tokensUsed: totalTokens,
          toolLoops: loopCount,
        });

        return {
          workerId: `${taskId}_claude-code`,
          workerType: 'claude-code',
          status: 'completed',
          model: settings.models.claudeCode,
          result,
          tokensUsed: totalTokens,
          durationMs: Date.now() - startTime,
        };
      }

      if (response.stop_reason === 'tool_use') {
        const toolBlocks = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const tool of toolBlocks) {
          onProgress?.(`Tool: ${tool.name}`);
          const result = await executeTool(tool.name, tool.input as Record<string, unknown>, ctx);
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tool.id,
            content: result.success ? result.output : `ERROR: ${result.error}`,
          });
        }
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults });
      }
    }
    throw new Error(`Max tool loops (${settings.maxToolLoops}) exceeded`);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    ctx.audit.log(taskId, 'worker_failed', 'gateway', { workerType: 'claude-code', error, tokensUsed: totalTokens });
    return {
      workerId: `${taskId}_claude-code`,
      workerType: 'claude-code',
      status: 'failed',
      model: settings.models.claudeCode,
      result: null,
      tokensUsed: totalTokens,
      durationMs: Date.now() - startTime,
      error,
    };
  }
}

function extractJson<T>(text: string): T {
  const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) return JSON.parse(codeBlockMatch[1]);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return JSON.parse(jsonMatch[0]);
  throw new Error('No JSON found in worker response');
}
