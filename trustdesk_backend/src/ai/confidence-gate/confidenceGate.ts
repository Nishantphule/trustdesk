export type GateResult = {
  pass: boolean;
  reason: string;
};

/**
 * Pure threshold check. Runs in ordinary code between retrieval and any drafting LLM call.
 */
export function check(score: number, threshold: number): GateResult {
  if (!Number.isFinite(score) || !Number.isFinite(threshold)) {
    return { pass: false, reason: "retrieval score or threshold is not a finite number" };
  }
  if (score < threshold) {
    return {
      pass: false,
      reason: `top retrieval score ${score.toFixed(4)} is below threshold ${threshold.toFixed(4)}`,
    };
  }
  return {
    pass: true,
    reason: `top retrieval score ${score.toFixed(4)} meets threshold ${threshold.toFixed(4)}`,
  };
}
