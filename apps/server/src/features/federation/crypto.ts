import { createPrivateKey, sign, verify } from 'node:crypto';
import { randomToken, sha256 } from '../../security/tokens.ts';
import { ed25519PublicKey, keyIdOf } from '../packs/signing.ts';

/** Accepted gap between the clocks of two instances, each way. */
export const SIGNATURE_WINDOW_S = 300;
/** Pairing codes expire this long after they are issued. */
export const PAIRING_TTL_MS = 15 * 60 * 1000;
const PREFIX = 'almanach-federation/1';

/** Headers carrying a request signature. */
export interface RequestSignature {
  keyId: string;
  timestamp: number;
  nonce: string;
  signature: string;
}

/** A federation failure, with a code the interface translates. */
export class FederationError extends Error {}

/**
 * Builds the exact text a request signature covers: method, path, time, nonce and body digest
 *
 * @param method {string} - HTTP method
 * @param path {string} - route path, e.g. /api/federation/exchange
 * @param timestamp {number} - Unix time in seconds
 * @param nonce {string} - one-time random value
 * @param body {string} - raw body
 * @returns {string} - text to sign
 */
function canonical(method: string, path: string, timestamp: number, nonce: string, body: string): string {
  return [PREFIX, method.toUpperCase(), path, timestamp, nonce, sha256(body)].join('\n');
}

/**
 * Signs an outgoing request with the private key of a link
 *
 * @param method {string} - HTTP method
 * @param path {string} - route path
 * @param body {string} - raw body
 * @param keys {{ publicKey: string; privateKey: string }} - raw public key and PKCS#8 PEM private key
 * @param now {number} - clock in milliseconds, injectable for tests
 * @returns {Record<string, string>} - headers to send
 */
export function signRequest(
  method: string,
  path: string,
  body: string,
  keys: { publicKey: string; privateKey: string },
  now = Date.now(),
): Record<string, string> {
  const timestamp = Math.floor(now / 1000);
  const nonce = randomToken(16);
  const text = canonical(method, path, timestamp, nonce, body);
  return {
    'x-almanach-key': keyIdOf(keys.publicKey),
    'x-almanach-timestamp': String(timestamp),
    'x-almanach-nonce': nonce,
    'x-almanach-signature': sign(null, Buffer.from(text), createPrivateKey(keys.privateKey)).toString(
      'base64url',
    ),
  };
}

/**
 * Reads the signature headers of an incoming request
 *
 * @param header {(name: string) => string | undefined} - header lookup
 * @returns {RequestSignature | null} - parsed headers, or null when missing or malformed
 */
export function readSignature(header: (name: string) => string | undefined): RequestSignature | null {
  const keyId = header('x-almanach-key') ?? '';
  const timestamp = header('x-almanach-timestamp') ?? '';
  const nonce = header('x-almanach-nonce') ?? '';
  const signature = header('x-almanach-signature') ?? '';
  if (
    !/^[0-9a-f]{16}$/.test(keyId) ||
    !/^\d{1,12}$/.test(timestamp) ||
    !/^[A-Za-z0-9_-]{22}$/.test(nonce) ||
    !/^[A-Za-z0-9_-]{86}$/.test(signature)
  )
    return null;
  return { keyId, timestamp: Number(timestamp), nonce, signature };
}

/**
 * Checks a request signature against the peer's public key and the clock; the nonce is recorded by the caller
 *
 * @param signed {RequestSignature} - parsed headers
 * @param request {{ method: string; path: string; body: string }} - what was received
 * @param publicKey {string} - raw Ed25519 public key of the peer, base64url
 * @param now {number} - clock in milliseconds, injectable for tests
 * @returns {string | null} - failure code, or null when valid
 */
export function checkSignature(
  signed: RequestSignature,
  request: { method: string; path: string; body: string },
  publicKey: string,
  now = Date.now(),
): string | null {
  if (keyIdOf(publicKey) !== signed.keyId) return 'unknown_link';
  if (Math.abs(Math.floor(now / 1000) - signed.timestamp) > SIGNATURE_WINDOW_S) return 'clock_skew';
  const text = canonical(request.method, request.path, signed.timestamp, signed.nonce, request.body);
  const valid = verify(
    null,
    Buffer.from(text),
    ed25519PublicKey(publicKey),
    Buffer.from(signed.signature, 'base64url'),
  );
  return valid ? null : 'bad_signature';
}

/**
 * Signs a response, bound to the nonce of the request it answers so it cannot be replayed
 *
 * @param nonce {string} - request nonce
 * @param body {string} - raw response body
 * @param privateKey {string} - PKCS#8 PEM private key
 * @returns {string} - signature, base64url
 */
export function signResponse(nonce: string, body: string, privateKey: string): string {
  const text = [PREFIX, 'response', nonce, sha256(body)].join('\n');
  return sign(null, Buffer.from(text), createPrivateKey(privateKey)).toString('base64url');
}

/**
 * Checks the signature of a response
 *
 * @param nonce {string} - nonce of the request sent
 * @param body {string} - raw response body
 * @param signature {string | null} - signature header
 * @param publicKey {string} - raw Ed25519 public key of the peer
 * @returns {boolean} - true when the peer signed this very answer
 */
export function verifyResponse(
  nonce: string,
  body: string,
  signature: string | null,
  publicKey: string,
): boolean {
  if (!signature || !/^[A-Za-z0-9_-]{86}$/.test(signature)) return false;
  const text = [PREFIX, 'response', nonce, sha256(body)].join('\n');
  return verify(null, Buffer.from(text), ed25519PublicKey(publicKey), Buffer.from(signature, 'base64url'));
}

/**
 * Tells whether a host name is the local machine or a private network address, the only places plain
 * HTTP is accepted (development, or a VPN that already encrypts)
 *
 * @param hostname {string} - URL host name
 * @returns {boolean} - true for localhost, loopback and private ranges
 */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  return /^f[cd][0-9a-f]{0,2}:/.test(host);
}

/**
 * Normalizes the address of an instance: HTTPS, or HTTP on localhost and private addresses only; no
 * credentials, query or fragment
 *
 * @param raw {string} - address typed or decoded from a code
 * @returns {string | null} - origin and path without trailing slash, or null when refused
 */
export function instanceUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isPrivateHost(url.hostname))) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/**
 * Builds a pairing code: one-time secret, fingerprint of the issuer's key and its address
 *
 * @param secret {string} - one-time secret
 * @param publicKey {string} - issuer's raw public key
 * @param url {string} - issuer's address
 * @returns {string} - code to copy to the other instance
 */
export function encodePairingCode(secret: string, publicKey: string, url: string): string {
  return [secret, keyIdOf(publicKey), Buffer.from(url).toString('base64url')].join('.');
}

/**
 * Reads a pairing code
 *
 * @param code {string} - code typed by the person
 * @returns {{ secret: string; fingerprint: string; url: string } | null} - parts, or null when malformed
 */
export function decodePairingCode(code: string): { secret: string; fingerprint: string; url: string } | null {
  const [secret, fingerprint, encoded, extra] = code.replace(/\s+/g, '').split('.');
  if (extra !== undefined || !secret || !fingerprint || !encoded) return null;
  if (!/^[A-Za-z0-9_-]{14}$/.test(secret) || !/^[0-9a-f]{16}$/.test(fingerprint)) return null;
  const url = instanceUrl(Buffer.from(encoded, 'base64url').toString('utf8'));
  return url ? { secret, fingerprint, url } : null;
}

/**
 * Reads a response body, giving up past a size limit
 *
 * @param response {Response} - HTTP response
 * @param max {number} - maximum size in bytes
 * @returns {Promise<string>} - body text
 * @throws {FederationError} - peer_too_large when the body is bigger
 */
export async function readLimited(response: Response, max: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new FederationError('peer_too_large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}
