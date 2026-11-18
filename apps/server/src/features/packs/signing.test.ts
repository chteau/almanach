import { describe, expect, test } from 'bun:test';
import { createPrivateKey, sign } from 'node:crypto';
import { BUNDLE_FORMAT, generateSigningKeys, keyIdOf, signBundle, verifyBundle } from './signing.ts';

const keys = generateSigningKeys();
const payload = {
  format: BUNDLE_FORMAT,
  country: 'FR',
  sequence: 2,
  createdAt: '2026-11-18T10:00:00.000Z',
  files: { 'pack.yaml': 'country: FR\n' },
} as const;

describe('pack signing', () => {
  test('a bundle signed by a trusted key verifies', () => {
    const bundle = signBundle({ ...payload, files: { ...payload.files } }, keys.privateKey);
    expect(bundle.keyId).toBe(keyIdOf(keys.publicKey));
    expect(verifyBundle(bundle, [keys.publicKey])).toEqual({
      payload: { ...payload, files: { ...payload.files } },
    });
  });

  test('tampering, unknown keys and forged signatures are refused', () => {
    const bundle = signBundle({ ...payload, files: { ...payload.files } }, keys.privateKey);
    const other = generateSigningKeys();
    expect(verifyBundle(bundle, [other.publicKey])).toEqual({ error: 'unknown_key' });
    const changed = Buffer.from(
      JSON.stringify({ ...payload, sequence: 99, files: { ...payload.files } }),
    ).toString('base64url');
    expect(verifyBundle({ ...bundle, payload: changed }, [keys.publicKey])).toEqual({
      error: 'bad_signature',
    });
    const forged = signBundle({ ...payload, files: { ...payload.files } }, other.privateKey);
    expect(verifyBundle({ ...forged, keyId: bundle.keyId }, [keys.publicKey])).toEqual({
      error: 'bad_signature',
    });
  });

  test('a validly signed but malformed payload is refused', () => {
    const bundle = signBundle({ ...payload, files: { ...payload.files } }, keys.privateKey);
    const bad = Buffer.from(JSON.stringify({ format: 'other' })).toString('base64url');
    const signature = sign(null, Buffer.from(bad), createPrivateKey(keys.privateKey)).toString('base64url');
    expect(verifyBundle({ ...bundle, payload: bad, signature }, [keys.publicKey])).toEqual({
      error: 'invalid_payload',
    });
  });
});
