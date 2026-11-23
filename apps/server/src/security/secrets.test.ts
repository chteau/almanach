import { expect, test } from 'bun:test';
import { decryptSecret, encryptSecret } from './secrets.ts';

const key = Buffer.alloc(32, 7);

test('secrets round-trip and are never stored in clear', () => {
  const stored = encryptSecret('rk_live_abc123', key);
  expect(stored).not.toContain('rk_live');
  expect(encryptSecret('rk_live_abc123', key)).not.toBe(stored);
  expect(decryptSecret(stored, key)).toBe('rk_live_abc123');
});

test('a tampered value or another key is rejected', () => {
  const stored = encryptSecret('rk_live_abc123', key);
  expect(() => decryptSecret(stored, Buffer.alloc(32, 8))).toThrow();
  expect(() => decryptSecret(`${stored.slice(0, -2)}AA`, key)).toThrow();
});
