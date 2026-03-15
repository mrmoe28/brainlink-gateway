import { describe, it, expect } from 'vitest';
import { synthesizeResults } from '../../src/workers/synthesis.js';
import type { WorkerResult } from '../../src/types/worker.js';

function mockWorker(type: string, result: unknown): WorkerResult {
  return {
    workerId: `test_${type}`,
    workerType: type as any,
    status: 'completed',
    model: 'test',
    result,
    tokensUsed: 100,
    durationMs: 1000,
  };
}

describe('synthesizeResults', () => {
  it('produces proceed when workers agree and confidence is high', () => {
    const cc = mockWorker('claude-code', {
      diagnosis: {
        summary: 'Null reference on subscription.items',
        rootCause: 'Missing null check on subscription items array',
        affectedFiles: ['webhook.ts'],
        confidence: 0.9,
        evidence: [],
      },
    });
    const rc = mockWorker('root-cause', { rootCause: 'subscription items null check missing', confidence: 0.8 });
    const risk = mockWorker('risk', { blastRadius: 'low', recommendation: 'safe to fix' });

    const result = synthesizeResults(cc, [rc, risk]);
    expect(result.recommendation).toBe('proceed');
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.agreementScore).toBeGreaterThan(0.5);
  });

  it('flags needs_review when workers disagree', () => {
    const cc = mockWorker('claude-code', {
      diagnosis: {
        summary: 'Null reference issue',
        rootCause: 'Missing null check on subscription items',
        affectedFiles: ['webhook.ts'],
        confidence: 0.85,
        evidence: [],
      },
    });
    const rc = mockWorker('root-cause', { rootCause: 'Race condition in database connection pool', confidence: 0.7 });

    const result = synthesizeResults(cc, [rc]);
    expect(result.recommendation).toBe('needs_review');
    expect(result.conflicts.length).toBeGreaterThan(0);
  });

  it('returns insufficient_data when claude-code fails', () => {
    const cc: WorkerResult = {
      workerId: 'test_cc', workerType: 'claude-code', status: 'failed',
      model: 'test', result: null, tokensUsed: 0, durationMs: 0, error: 'API error',
    };
    const result = synthesizeResults(cc, []);
    expect(result.recommendation).toBe('insufficient_data');
    expect(result.confidence).toBe(0);
  });

  it('returns insufficient_data when too few workers complete', () => {
    const cc = mockWorker('claude-code', {
      diagnosis: { summary: 'Issue', rootCause: 'Some cause', affectedFiles: [], confidence: 0.9, evidence: [] },
    });
    const failed: WorkerResult = {
      workerId: 'test_f1', workerType: 'reproduce', status: 'failed',
      model: 'test', result: null, tokensUsed: 0, durationMs: 0,
    };
    const timedOut: WorkerResult = {
      workerId: 'test_f2', workerType: 'risk', status: 'timed_out',
      model: 'test', result: null, tokensUsed: 0, durationMs: 0,
    };
    const result = synthesizeResults(cc, [failed, timedOut]);
    expect(result.recommendation).toBe('insufficient_data');
  });

  it('collects additional issues from risk worker', () => {
    const cc = mockWorker('claude-code', {
      diagnosis: { summary: 'Bug', rootCause: 'null check', affectedFiles: [], confidence: 0.9, evidence: [] },
    });
    const risk = mockWorker('risk', {
      blastRadius: 'low',
      similarIssues: [{ description: 'Same pattern in handler B' }, { description: 'Same pattern in handler C' }],
      recommendation: 'fix all',
    });
    const rc = mockWorker('root-cause', { rootCause: 'null check missing', confidence: 0.8 });

    const result = synthesizeResults(cc, [risk, rc]);
    expect(result.additionalIssues.length).toBe(2);
    expect(result.additionalIssues[0]).toContain('handler B');
  });

  it('proceeds with CC only when no cowork workers sent', () => {
    const cc = mockWorker('claude-code', {
      diagnosis: { summary: 'Bug', rootCause: 'null check', affectedFiles: [], confidence: 0.9, evidence: [] },
    });
    const result = synthesizeResults(cc, []);
    expect(result.recommendation).toBe('proceed');
    expect(result.agreementScore).toBe(1);
  });
});
