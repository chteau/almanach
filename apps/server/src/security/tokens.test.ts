import { expect, test } from 'bun:test';
import { randomToken, safeEqual, sha256 } from './tokens.ts';

test('randomToken is url-safe and unique', () => {
  const a = randomToken();
  expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(randomToken()).not.toBe(a);
});

test('sha256 and safeEqual', () => {
  expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(safeEqual('same', 'same')).toBe(true);
  expect(safeEqual('same', 'diff')).toBe(false);
  expect(safeEqual('short', 'longer')).toBe(false);
});
