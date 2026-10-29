import { AppError } from "../domain/errors";

/**
 * Small in-memory limiter for public and authentication endpoints. It is
 * intentionally process-local: the local tournament server is a single node,
 * and this is a abuse brake, not a billing quota.
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  options: { limit: number; windowMs: number },
): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  bucket.count += 1;
  if (bucket.count > options.limit) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function enforceRateLimit(
  key: string,
  options: { limit: number; windowMs: number },
): void {
  const result = rateLimit(key, options);
  if (!result.allowed) {
    throw new AppError("rate_limited", `Too many requests. Try again in ${result.retryAfterSeconds}s.`);
  }
}

/** Test helper. */
export function resetRateLimits(): void {
  buckets.clear();
}

// Keep the map from growing without bound in long-running processes.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60_000).unref?.();
