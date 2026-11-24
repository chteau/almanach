import { describe, expect, test } from 'bun:test';
import { decryptBytes, decryptSecret, encryptBytes, encryptSecret, vaultKey } from './secrets.ts';

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

describe('vault file encryption', () => {
  const key = vaultKey(Buffer.alloc(32, 7));

  test('round trip, a fresh IV each time, a different key from the secrets one', () => {
    const plain = Buffer.from('%PDF-1.7 contract');
    const first = encryptBytes(plain, key);
    expect(decryptBytes(first, key)).toEqual(plain);
    expect(encryptBytes(plain, key).equals(first)).toBe(false);
    expect(key.equals(Buffer.alloc(32, 7))).toBe(false);
  });

  test('a wrong key or an altered byte is refused', () => {
    const stored = encryptBytes(Buffer.from('data'), key);
    expect(() => decryptBytes(stored, vaultKey(Buffer.alloc(32, 8)))).toThrow();
    const altered = Buffer.from(stored);
    altered[altered.length - 1] = (altered.at(-1) ?? 0) ^ 1;
    expect(() => decryptBytes(altered, key)).toThrow();
  });
});
