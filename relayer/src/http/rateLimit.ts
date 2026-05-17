/**
 * Shared per-IP token-bucket rate limiter.
 *
 * One implementation, used by both the notification API and the (CPU-heavy,
 * unauthenticated) prover endpoints. Keeping a single source avoids the
 * copy-paste divergence class of bug — see audit S8, where the relayer email
 * parser had drifted from the SDK and lost its regex escaping.
 *
 * This is a baseline; production deployments should still front the service
 * with a real WAF / edge rate-limit.
 */
import type { Request, Response, NextFunction } from "express";

export interface RateLimitOptions {
  /** Burst size — tokens available immediately. */
  capacity: number;
  /** Sustained refill rate, tokens per second. */
  refillPerSec: number;
  /** Body for the 429 response. */
  message?: string;
}

type Bucket = { tokens: number; updatedAt: number };

export function makeRateLimiter(opts: RateLimitOptions) {
  const { capacity, refillPerSec, message = "rate limit exceeded" } = opts;
  if (capacity <= 0 || refillPerSec <= 0) {
    throw new Error("rate limiter: capacity and refillPerSec must be > 0");
  }
  const buckets = new Map<string, Bucket>();

  return function rateLimit(
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const key = req.ip ?? "unknown";
    const now = Date.now();
    let b = buckets.get(key);
    if (!b) {
      b = { tokens: capacity, updatedAt: now };
      buckets.set(key, b);
    }
    const elapsed = (now - b.updatedAt) / 1000;
    b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSec);
    b.updatedAt = now;
    if (b.tokens < 1) {
      res.status(429).json({ error: message });
      return;
    }
    b.tokens -= 1;
    next();
  };
}
