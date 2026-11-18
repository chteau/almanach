import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Generates a cryptographically random, URL-safe token
 *
 * @param bytes {number} - amount of entropy in bytes
 * @returns {string} - base64url-encoded token
 */
export function randomToken(bytes = 32): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64url');
}

/**
 * Hashes a secret with SHA-256 so only its digest is ever stored
 *
 * @param value {string} - secret to hash
 * @returns {string} - hexadecimal digest
 */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Compares two strings in constant time to avoid timing attacks
 *
 * @param a {string} - first value
 * @param b {string} - second value
 * @returns {boolean} - true when both values are identical
 */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
