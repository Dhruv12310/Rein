// Optimistic-concurrency retry. DSQL takes no row locks: two transactions that write the same
// row both proceed, and the second to COMMIT fails with a serialization error. We retry on
// that and only that. A business outcome, a blocked purchase, is a normal return value, never
// a thrown error, so the only thing this helper ever retries is a real write-write conflict.

const SERIALIZATION_FAILURE = "40001";

// Both OC000 (row write conflict) and OC001 (schema or catalog conflict) reach node-postgres as
// SQLSTATE 40001. The sub-code lives in the message if we ever need to tell them apart; for
// retry purposes they are treated the same.
export function isSerializationError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === SERIALIZATION_FAILURE
  );
}

export class OccRetriesExhausted extends Error {
  readonly attempts: number;
  constructor(attempts: number, cause: unknown) {
    super(`Transaction still conflicting after ${attempts} attempts (SQLSTATE 40001).`);
    this.name = "OccRetriesExhausted";
    this.attempts = attempts;
    this.cause = cause;
  }
}

export type RetryOptions = {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
};

export type RetryOutcome<T> = {
  result: T;
  attempts: number; // total times run executed; 1 means it committed with no conflict
  retries: number; // attempts minus 1, the number of 40001s that forced a fresh re-run
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Full jitter: a random delay in [0, ceiling], where the ceiling grows exponentially with the
// attempt up to a cap. The randomness keeps racing callers from retrying in lockstep, which is
// what would otherwise turn contention into a thundering herd.
function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
  return Math.random() * ceiling;
}

// Run `run` until it commits or we exhaust attempts. `run` must be safe to execute again from
// the top: each attempt opens its own transaction and re-reads state, so a retry decides
// against the latest balance rather than a stale one.
export async function withOccRetry<T>(
  run: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<RetryOutcome<T>> {
  const maxAttempts = options.maxAttempts ?? 8;
  const baseDelayMs = options.baseDelayMs ?? 10;
  const maxDelayMs = options.maxDelayMs ?? 250;

  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      const result = await run(attempt);
      return { result, attempts: attempt, retries: attempt - 1 };
    } catch (err) {
      if (!isSerializationError(err)) {
        throw err;
      }
      if (attempt >= maxAttempts) {
        throw new OccRetriesExhausted(attempt, err);
      }
      await sleep(backoffDelay(attempt, baseDelayMs, maxDelayMs));
    }
  }
}
