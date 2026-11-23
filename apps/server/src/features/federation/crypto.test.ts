import { describe, expect, test } from 'bun:test';
import { generateSigningKeys, keyIdOf } from '../packs/signing.ts';
import {
  checkSignature,
  decodePairingCode,
  encodePairingCode,
  instanceUrl,
  readLimited,
  readSignature,
  signRequest,
  signResponse,
  verifyResponse,
} from './crypto.ts';
import { monthlyTotals } from './federation.ts';

const keys = generateSigningKeys();
const other = generateSigningKeys();
const NOW = Date.UTC(2026, 10, 23, 12);
const request = { method: 'POST', path: '/api/federation/exchange', body: '{"receive":true,"totals":null}' };

/**
 * Signs the test request and reads it back as the receiving side would
 *
 * @param at {number} - signing time in milliseconds
 * @returns {NonNullable<ReturnType<typeof readSignature>>} - parsed signature headers
 */
function signed(at = NOW) {
  const headers = signRequest(request.method, request.path, request.body, keys, at);
  const parsed = readSignature((name) => headers[name]);
  if (!parsed) throw new Error('unreadable signature');
  return parsed;
}

describe('signed requests', () => {
  test('a request signed by the link key is accepted', () => {
    expect(signed().keyId).toBe(keyIdOf(keys.publicKey));
    expect(checkSignature(signed(), request, keys.publicKey, NOW)).toBeNull();
  });

  test('a body, path or method changed after signing is refused', () => {
    const signature = signed();
    expect(
      checkSignature(
        signature,
        { ...request, body: request.body.replace('true', 'false') },
        keys.publicKey,
        NOW,
      ),
    ).toBe('bad_signature');
    expect(
      checkSignature(signature, { ...request, path: '/api/federation/revoke' }, keys.publicKey, NOW),
    ).toBe('bad_signature');
    expect(checkSignature(signature, { ...request, method: 'PUT' }, keys.publicKey, NOW)).toBe(
      'bad_signature',
    );
  });

  test('a signature by another key is refused', () => {
    const forged = { ...signed(), keyId: keyIdOf(other.publicKey) };
    expect(checkSignature(forged, request, other.publicKey, NOW)).toBe('bad_signature');
    expect(checkSignature(signed(), request, other.publicKey, NOW)).toBe('unknown_link');
  });

  test('clocks may differ by five minutes, not more', () => {
    expect(checkSignature(signed(NOW - 299_000), request, keys.publicKey, NOW)).toBeNull();
    expect(checkSignature(signed(NOW + 299_000), request, keys.publicKey, NOW)).toBeNull();
    expect(checkSignature(signed(NOW - 301_000), request, keys.publicKey, NOW)).toBe('clock_skew');
    expect(checkSignature(signed(NOW + 301_000), request, keys.publicKey, NOW)).toBe('clock_skew');
  });

  test('missing or malformed headers are refused', () => {
    expect(readSignature(() => undefined)).toBeNull();
    const headers = signRequest('POST', request.path, request.body, keys, NOW);
    expect(readSignature((name) => (name === 'x-almanach-nonce' ? 'short' : headers[name]))).toBeNull();
  });

  test('every request carries a fresh nonce', () => {
    expect(signed().nonce).not.toBe(signed().nonce);
  });
});

describe('signed responses', () => {
  test('an answer is bound to the request nonce, so it cannot be replayed for another request', () => {
    const body = '{"totals":null}';
    const signature = signResponse('nonce-of-request-1', body, keys.privateKey);
    expect(verifyResponse('nonce-of-request-1', body, signature, keys.publicKey)).toBe(true);
    expect(verifyResponse('nonce-of-request-2', body, signature, keys.publicKey)).toBe(false);
    expect(verifyResponse('nonce-of-request-1', '{"totals":{}}', signature, keys.publicKey)).toBe(false);
    expect(verifyResponse('nonce-of-request-1', body, signature, other.publicKey)).toBe(false);
    expect(verifyResponse('nonce-of-request-1', body, null, keys.publicKey)).toBe(false);
  });
});

describe('addresses and pairing codes', () => {
  test('HTTPS everywhere, plain HTTP only on localhost and private addresses', () => {
    expect(instanceUrl('https://almanach.example.org/')).toBe('https://almanach.example.org');
    expect(instanceUrl('https://example.org/almanach/')).toBe('https://example.org/almanach');
    expect(instanceUrl('http://localhost:8080')).toBe('http://localhost:8080');
    expect(instanceUrl('http://10.8.0.2:8080')).toBe('http://10.8.0.2:8080');
    expect(instanceUrl('http://192.168.1.20')).toBe('http://192.168.1.20');
    expect(instanceUrl('http://[fd00::2]:8080')).toBe('http://[fd00::2]:8080');
    expect(instanceUrl('http://almanach.example.org')).toBeNull();
    expect(instanceUrl('http://8.8.8.8')).toBeNull();
    expect(instanceUrl('https://user:pass@example.org')).toBeNull();
    expect(instanceUrl('https://example.org/?next=x')).toBeNull();
    expect(instanceUrl('ftp://example.org')).toBeNull();
  });

  test('a code carries the secret, the key fingerprint and the address', () => {
    const code = encodePairingCode('abcdefghijklmn', keys.publicKey, 'https://a.example.org');
    expect(decodePairingCode(` ${code} `)).toEqual({
      secret: 'abcdefghijklmn',
      fingerprint: keyIdOf(keys.publicKey),
      url: 'https://a.example.org',
    });
    expect(decodePairingCode(`${code}.extra`)).toBeNull();
    expect(
      decodePairingCode(encodePairingCode('abcdefghijklmn', keys.publicKey, 'http://a.example.org')),
    ).toBeNull();
  });
});

describe('data shared with a linked instance', () => {
  test('only monthly totals per fiscal category leave the instance', () => {
    const receipts = [
      { date: '2026-01-05', cents: 120_000, client: 'Acme', reference: 'F-1' },
      { date: '2026-01-28', cents: 30_000 },
      { date: '2026-02-03', cents: -10_000 },
      { date: '2026-07-10', cents: 50_000 },
    ];
    const months = monthlyTotals(receipts, (date) =>
      date < '2026-07-01' ? 'micro_bnc' : 'micro_bic_services',
    );
    expect(months).toEqual([
      { month: '2026-01', category: 'micro_bnc', cents: 150_000 },
      { month: '2026-02', category: 'micro_bnc', cents: -10_000 },
      { month: '2026-07', category: 'micro_bic_services', cents: 50_000 },
    ]);
    expect(JSON.stringify(months)).not.toMatch(/Acme|F-1|2026-01-05/);
  });

  test('a peer answer larger than the limit is not read', async () => {
    expect(await readLimited(new Response('x'.repeat(10)), 10)).toBe('x'.repeat(10));
    await expect(readLimited(new Response('x'.repeat(11)), 10)).rejects.toThrow('peer_too_large');
  });
});
