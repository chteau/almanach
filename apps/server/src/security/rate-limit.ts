import type { MiddlewareHandler } from 'hono';

interface Window {
  count: number;
  resetAt: number;
}

/** Fixed-window, in-memory rate limiter keyed by an arbitrary string (IP, account…). */
export class RateLimiter {
  private readonly windows = new Map<string, Window>();

  /**
   * Creates a limiter
   *
   * @param limit {number} - maximum number of hits per window
   * @param windowMs {number} - window length in milliseconds
   * @param now {() => number} - clock, injectable for tests
   */
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Records a hit for a key and tells whether it is still allowed
   *
   * @param key {string} - identity being limited
   * @returns {{ allowed: boolean; retryAfterSeconds: number }} - decision and seconds until the window resets
   */
  hit(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const now = this.now();
    if (this.windows.size > 10_000) this.prune(now);
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + this.windowMs };
      this.windows.set(key, window);
    }
    window.count += 1;
    return {
      allowed: window.count <= this.limit,
      retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
    };
  }

  /**
   * Drops expired windows so memory stays bounded
   *
   * @param now {number} - current timestamp in milliseconds
   * @returns {void} - nothing
   */
  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }
}

/**
 * Builds a Hono middleware that answers 429 once a key exceeds its limit
 *
 * @param limiter {RateLimiter} - limiter shared by the routes it protects
 * @param keyOf {(c: Parameters<MiddlewareHandler>[0]) => string} - extracts the key from the request
 * @returns {MiddlewareHandler} - the middleware
 */
export function rateLimit(
  limiter: RateLimiter,
  keyOf: (c: Parameters<MiddlewareHandler>[0]) => string,
): MiddlewareHandler {
  return async (c, next) => {
    const { allowed, retryAfterSeconds } = limiter.hit(keyOf(c));
    if (!allowed) {
      c.header('Retry-After', String(retryAfterSeconds));
      return c.json({ error: 'rate_limited' }, 429);
    }
    await next();
  };
}
