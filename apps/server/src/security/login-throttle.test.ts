import { describe, expect, test } from 'bun:test';
import { ACCOUNT_FAILURES, IP_FAILURES, LOCK_MS, LoginThrottle } from './login-throttle.ts';

describe('LoginThrottle', () => {
  test('locks an account after repeated failures, then releases it', () => {
    let now = 0;
    const throttle = new LoginThrottle(() => now);
    for (let i = 0; i < ACCOUNT_FAILURES; i++) throttle.fail('a@x.io', '1.1.1.1');
    expect(throttle.lockedFor('a@x.io', '2.2.2.2')).toBe(LOCK_MS / 1000);
    expect(throttle.lockedFor('b@x.io', '2.2.2.2')).toBe(0);
    now += LOCK_MS;
    expect(throttle.lockedFor('a@x.io', '2.2.2.2')).toBe(0);
  });

  test('locks an IP spraying many accounts', () => {
    const throttle = new LoginThrottle(() => 0);
    for (let i = 0; i < IP_FAILURES; i++) throttle.fail(`u${i}@x.io`, '9.9.9.9');
    expect(throttle.lockedFor('new@x.io', '9.9.9.9')).toBeGreaterThan(0);
  });

  test('a success clears the account counter', () => {
    const throttle = new LoginThrottle(() => 0);
    for (let i = 0; i < ACCOUNT_FAILURES - 1; i++) throttle.fail('a@x.io', '1.1.1.1');
    throttle.succeed('a@x.io');
    throttle.fail('a@x.io', '1.1.1.1');
    expect(throttle.lockedFor('a@x.io', '1.1.1.1')).toBe(0);
  });
});
