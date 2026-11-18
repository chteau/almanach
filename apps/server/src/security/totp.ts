import { createHmac } from 'node:crypto';
import { safeEqual } from './tokens.ts';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;

/**
 * Encodes bytes in RFC 4648 base32 without padding, the format authenticator apps expect
 *
 * @param bytes {Uint8Array} - raw bytes
 * @returns {string} - base32 text
 */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

/**
 * Decodes RFC 4648 base32, ignoring padding, spaces and case
 *
 * @param text {string} - base32 text
 * @returns {Uint8Array} - raw bytes
 */
export function base32Decode(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[\s=]/g, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('invalid_base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(bytes);
}

/**
 * Generates a new 160-bit TOTP secret
 *
 * @returns {string} - base32 secret
 */
export function newTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

/**
 * Computes the six-digit HOTP code of a counter (RFC 4226, HMAC-SHA1)
 *
 * @param secret {string} - base32 secret
 * @param counter {number} - moving factor
 * @returns {string} - zero-padded code
 */
export function hotp(secret: string, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = (digest[19] ?? 0) & 15;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, '0');
}

/**
 * Checks a TOTP code (RFC 6238) allowing one step of clock drift, and refuses steps already used
 *
 * @param secret {string} - base32 secret
 * @param code {string} - six digits typed by the person
 * @param lastStep {number | null} - last accepted step, to block replays
 * @param now {number} - current time in milliseconds
 * @returns {number | null} - the matched step, or null when the code is wrong or reused
 */
export function verifyTotp(
  secret: string,
  code: string,
  lastStep: number | null,
  now = Date.now(),
): number | null {
  const current = Math.floor(now / 1000 / STEP_SECONDS);
  for (const step of [current - 1, current, current + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    if (safeEqual(hotp(secret, step), code)) return step;
  }
  return null;
}

/**
 * Builds the otpauth:// URI that authenticator apps import
 *
 * @param secret {string} - base32 secret
 * @param account {string} - account name, the e-mail
 * @param issuer {string} - service name
 * @returns {string} - URI
 */
export function otpauthUri(secret: string, account: string, issuer = 'Almanach'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}

/**
 * Generates single-use recovery codes, ten lowercase letters or digits each
 *
 * @param count {number} - number of codes
 * @returns {string[]} - codes, shown once
 */
export function recoveryCodes(count = 8): string[] {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from({ length: count }, () =>
    Array.from(crypto.getRandomValues(new Uint8Array(10)), (byte) => alphabet[byte % alphabet.length]).join(
      '',
    ),
  );
}
