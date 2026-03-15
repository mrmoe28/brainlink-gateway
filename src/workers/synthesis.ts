import type { WorkerResult } from '../types/worker.js';
import type { Synthesis, Diagnosis } from '../types/task.js';

export function synthesizeResults(
  claudeCodeResult: WorkerResult,
  coworkResults: WorkerResult[],
): Synthesis {
  const completedWorkers = coworkResults.filter(w => w.status === 'completed');
  const ccResult = claudeCodeResult.result as { diagnosis?: Diagnosis } | null;
  const ccDiagnosis = ccResult?.diagnosis;

  if (!ccDiagnosis || claudeCodeResult.status !== 'completed') {
    return {
      summary: 'Analysis failed -- Claude Code worker did not complete.',
      rootCause: 'Unknown',
      confidence: 0,
      agreementScore: 0,
      conflicts: [],
      recommendation: 'insufficient_data',
      additionalIssues: [],
    };
  }

  const agreementScore = computeAgreement(ccDiagnosis, completedWorkers);

  const conflicts: string[] = [];
  for (const worker of completedWorkers) {
    const workerResult = worker.result as Record<string, unknown> | null;
    if (!workerResult) continue;
    const workerRootCause = (workerResult.rootCause as string) ?? '';
    if (workerRootCause && !hasOverlap(ccDiagnosis.rootCause, workerRootCause)) {
      conflicts.push(`${worker.workerType} disagrees: "${workerRootCause}"`);
    }
  }

  const additionalIssues: string[] = [];
  const riskWorker = completedWorkers.find(w => w.workerType === 'risk');
  if (riskWorker?.result) {
    const riskResult = riskWorker.result as Record<string, unknown>;
    const similarIssues = riskResult.similarIssues as Array<{ description: string }> | undefined;
    if (similarIssues) {
      additionalIssues.push(...similarIssues.map(i => i.description));
    }
  }

  let recommendation: Synthesis['recommendation'];
  const majorityFailed = coworkResults.length >= 2 && completedWorkers.length < coworkResults.length / 2;
  if (majorityFailed) {
    recommendation = 'insufficient_data';
  } else if (agreementScore < 0.6 || conflicts.length > 0) {
    recommendation = 'needs_review';
  } else if (ccDiagnosis.confidence >= 0.7) {
    recommendation = 'proceed';
  } else {
    recommendation = 'needs_review';
  }

  return {
    summary: ccDiagnosis.summary,
    rootCause: ccDiagnosis.rootCause,
    confidence: ccDiagnosis.confidence,
    agreementScore,
    conflicts,
    recommendation,
    additionalIssues,
  };
}

function computeAgreement(diagnosis: Diagnosis, workers: WorkerResult[]): number {
  if (workers.length === 0) return 1;
  let agreeing = 0;
  let comparable = 0;
  for (const worker of workers) {
    const result = worker.result as Record<string, unknown> | null;
    if (!result) continue;
    const workerText = (result.rootCause as string) ?? (result.scenario as string) ?? '';
    if (!workerText) continue;
    comparable++;
    if (hasOverlap(diagnosis.rootCause, workerText)) agreeing++;
  }
  return comparable === 0 ? 1 : agreeing / comparable;
}

function extractKeywords(text: string): Set<string> {
  const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'not', 'and', 'or', 'but']);
  return new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w)),
  );
}

function hasOverlap(text1: string, text2: string): boolean {
  const kw1 = extractKeywords(text1);
  const kw2 = extractKeywords(text2);
  let overlap = 0;
  for (const word of kw1) { if (kw2.has(word)) overlap++; }
  const union = new Set([...kw1, ...kw2]).size;
  return union > 0 && overlap / union > 0.2;
}
