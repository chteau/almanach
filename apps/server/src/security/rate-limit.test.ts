import { expect, test } from 'bun:test';
import { RateLimiter } from './rate-limit.ts';

test('blocks after the limit and resets with the window', () => {
  let now = 0;
  const limiter = new RateLimiter(2, 1000, () => now);
  expect(limiter.hit('ip').allowed).toBe(true);
  expect(limiter.hit('ip').allowed).toBe(true);
  const blocked = limiter.hit('ip');
  expect(blocked.allowed).toBe(false);
  expect(blocked.retryAfterSeconds).toBe(1);
  expect(limiter.hit('other').allowed).toBe(true);
  now = 1000;
  expect(limiter.hit('ip').allowed).toBe(true);
});
