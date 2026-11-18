import { describe, expect, test } from 'bun:test';
import { base32Decode, base32Encode, hotp, otpauthUri, recoveryCodes, verifyTotp } from './totp.ts';

// RFC 6238 appendix B uses the ASCII secret "12345678901234567890".
const SECRET = base32Encode(new TextEncoder().encode('12345678901234567890'));

describe('totp', () => {
  test('base32 round-trips', () => {
    expect(SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(new TextDecoder().decode(base32Decode(SECRET))).toBe('12345678901234567890');
  });

  test('matches the RFC 4226 and RFC 6238 test vectors', () => {
    expect(hotp(SECRET, 0)).toBe('755224');
    expect(hotp(SECRET, 9)).toBe('520489');
    // T = 59 s gives 94287082 with 8 digits, so 287082 with 6.
    expect(verifyTotp(SECRET, '287082', null, 59_000)).toBe(1);
    expect(verifyTotp(SECRET, '081804', null, 1_111_111_109_000)).toBe(37_037_036);
  });

  test('accepts one step of drift and refuses replays', () => {
    const code = hotp(SECRET, 100);
    expect(verifyTotp(SECRET, code, null, 101 * 30_000)).toBe(100);
    expect(verifyTotp(SECRET, code, 100, 101 * 30_000)).toBeNull();
    expect(verifyTotp(SECRET, code, null, 103 * 30_000)).toBeNull();
    expect(verifyTotp(SECRET, '000000', null, 101 * 30_000)).toBeNull();
  });

  test('builds an authenticator URI and distinct recovery codes', () => {
    expect(otpauthUri(SECRET, 'a@b.fr')).toContain('otpauth://totp/Almanach%3Aa%40b.fr?secret=');
    const codes = recoveryCodes();
    expect(new Set(codes).size).toBe(8);
    expect(codes.every((code) => /^[a-z0-9]{10}$/.test(code))).toBe(true);
  });
});
