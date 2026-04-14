import { SMEK_OUTCOME, type SmekLoopCompletedResult, type SmekLoopResult } from './smek-kernel.dto';

/** PRD v1.1 §11 — propagate compliance blocks as domain errors when the caller expects a completed loop. */
export function requireSmekCompleted(
  result: SmekLoopResult,
  toError: (message: string) => Error,
): SmekLoopCompletedResult {
  if (result.outcome === SMEK_OUTCOME.COMPLIANCE_BLOCKED) {
    throw toError(`[${result.blockCode}] ${result.message}`);
  }
  return result;
}
