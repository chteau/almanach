/** Failures allowed per account before a temporary lock. */
export const ACCOUNT_FAILURES = 5;
/** Failures allowed per IP address before a temporary lock (covers spraying many accounts). */
export const IP_FAILURES = 30;
/** Lock and counting window length. */
export const LOCK_MS = 15 * 60 * 1000;

interface Entry {
  failures: number;
  firstAt: number;
  lockedUntil: number;
}

/** Counts failed sign-ins per account and per IP, and locks both temporarily (S-012). */
export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();

  /**
   * Creates the throttle
   *
   * @param now {() => number} - clock, injectable for tests
   */
  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Tells how long sign-in stays locked for this account and IP
   *
   * @param email {string} - normalized e-mail address
   * @param ip {string} - client IP address
   * @returns {number} - seconds until sign-in is allowed again, 0 when allowed
   */
  lockedFor(email: string, ip: string): number {
    const now = this.now();
    const until = Math.max(this.entry(`a:${email}`, now).lockedUntil, this.entry(`i:${ip}`, now).lockedUntil);
    return until > now ? Math.ceil((until - now) / 1000) : 0;
  }

  /**
   * Records a failed attempt and locks the account or IP once its limit is reached
   *
   * @param email {string} - normalized e-mail address
   * @param ip {string} - client IP address
   * @returns {void} - nothing
   */
  fail(email: string, ip: string): void {
    const now = this.now();
    for (const [key, limit] of [
      [`a:${email}`, ACCOUNT_FAILURES],
      [`i:${ip}`, IP_FAILURES],
    ] as const) {
      const entry = this.entry(key, now);
      entry.failures += 1;
      if (entry.failures >= limit) entry.lockedUntil = now + LOCK_MS;
      this.entries.set(key, entry);
    }
    if (this.entries.size > 50_000) this.prune(now);
  }

  /**
   * Forgets the account's failures after a successful sign-in
   *
   * @param email {string} - normalized e-mail address
   * @returns {void} - nothing
   */
  succeed(email: string): void {
    this.entries.delete(`a:${email}`);
  }

  /**
   * Returns the live entry for a key, starting a fresh one when the window has passed
   *
   * @param key {string} - account or IP key
   * @param now {number} - current timestamp
   * @returns {Entry} - the entry
   */
  private entry(key: string, now: number): Entry {
    const entry = this.entries.get(key);
    if (entry && (entry.lockedUntil > now || now - entry.firstAt < LOCK_MS)) return entry;
    return { failures: 0, firstAt: now, lockedUntil: 0 };
  }

  /**
   * Drops stale entries so memory stays bounded
   *
   * @param now {number} - current timestamp
   * @returns {void} - nothing
   */
  private prune(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.lockedUntil <= now && now - entry.firstAt >= LOCK_MS) this.entries.delete(key);
    }
  }
}
