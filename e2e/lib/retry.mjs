// Explicit, inspectable retry helper. Every attempt is recorded so tests and
// the calibration script can report *what happened*, not just the outcome.

/** Default backoff schedule (ms) — replaced by the calibrated one at runtime. */
export const DEFAULT_SCHEDULE = [250, 500, 1000];

/**
 * retry(fn, options)
 *   fn(attempt) → value; throw (or return a value `shouldRetry` rejects) to retry.
 *   schedule: waits between attempts; attempts = schedule.length + 1.
 *   shouldRetry(error, value) → boolean (default: retry on any thrown error).
 * Resolves { value, attempts: [{attempt, ok, error?, durationMs, waitedMs}] }.
 */
export async function retry(fn, { schedule = DEFAULT_SCHEDULE, shouldRetry = (error) => Boolean(error), label = "operation" } = {}) {
  const attempts = [];
  let waitedMs = 0;
  for (let attempt = 1; attempt <= schedule.length + 1; attempt++) {
    const started = Date.now();
    try {
      const value = await fn(attempt);
      const durationMs = Date.now() - started;
      if (!shouldRetry(undefined, value)) {
        attempts.push({ attempt, ok: true, durationMs, waitedMs });
        return { value, attempts };
      }
      attempts.push({ attempt, ok: false, durationMs, waitedMs, error: "rejected by shouldRetry" });
    } catch (error) {
      const durationMs = Date.now() - started;
      attempts.push({ attempt, ok: false, durationMs, waitedMs, error: String(error?.message ?? error) });
      if (!shouldRetry(error, undefined)) {
        const wrapped = new Error(`${label} failed without retry: ${attempts.at(-1).error}`);
        wrapped.attempts = attempts;
        throw wrapped;
      }
    }
    if (attempt <= schedule.length) {
      waitedMs = schedule[attempt - 1];
      await new Promise((r) => setTimeout(r, waitedMs));
    }
  }
  const error = new Error(`${label} failed after ${attempts.length} attempts: ${attempts.at(-1)?.error}`);
  error.attempts = attempts;
  throw error;
}

/** Percentile helpers used to summarise samples (nearest-rank). */
export function summarise(samples) {
  const sorted = [...samples].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (sorted.length === 0) return { n: 0, min: null, p50: null, p95: null, max: null, mean: null };
  const round1 = (value) => Math.round(value * 10) / 10;
  const rank = (p) => round1(sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return { n: sorted.length, min: round1(sorted[0]), p50: rank(50), p95: rank(95), max: round1(sorted.at(-1)), mean: round1(mean) };
}
