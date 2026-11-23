import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  sign,
  verify,
} from 'node:crypto';
import { z } from 'zod';
import { sha256 } from '../../security/tokens.ts';

export const BUNDLE_FORMAT = 'almanach-pack/1';

/** What the publisher signs: one country's pack.yaml and yearly rules. */
export const bundlePayloadSchema = z
  .object({
    format: z.literal(BUNDLE_FORMAT),
    country: z.string().regex(/^[A-Z]{2}$/),
    sequence: z.number().int().min(1).max(2_000_000_000),
    createdAt: z.iso.datetime(),
    notes: z.string().max(2000).optional(),
    files: z
      .record(z.string().regex(/^(pack|\d{4})\.yaml$/), z.string().max(500_000))
      .refine((files) => 'pack.yaml' in files, { message: 'pack_yaml_missing' }),
  })
  .strict();

export type BundlePayload = z.output<typeof bundlePayloadSchema>;

/** File exchanged between publisher and instances: the payload, base64url-encoded, and its signature. */
export const signedBundleSchema = z
  .object({
    payload: z.string().max(2_000_000),
    signature: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
    keyId: z.string().regex(/^[0-9a-f]{16}$/),
  })
  .strict();

export type SignedBundle = z.output<typeof signedBundleSchema>;

/**
 * Short identifier of a public key: the first 16 hex digits of its SHA-256
 *
 * @param publicKey {string} - raw Ed25519 public key, base64url
 * @returns {string} - key id
 */
export function keyIdOf(publicKey: string): string {
  return sha256(publicKey).slice(0, 16);
}

/**
 * Turns a raw Ed25519 public key into a key object
 *
 * @param publicKey {string} - raw public key, base64url
 * @returns {KeyObject} - key usable with crypto.verify
 */
export function ed25519PublicKey(publicKey: string): KeyObject {
  return createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicKey }, format: 'jwk' });
}

/**
 * Creates a new Ed25519 key pair for signing packs or federation requests
 *
 * @returns {{ publicKey: string; privateKey: string }} - raw public key (base64url) and private key (PKCS#8 PEM)
 */
export function generateSigningKeys(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' });
  return {
    publicKey: jwk.x ?? '',
    privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  };
}

/**
 * Signs a payload with a private key
 *
 * @param payload {BundlePayload} - content to publish
 * @param privateKeyPem {string} - PKCS#8 PEM private key
 * @returns {SignedBundle} - signed bundle
 */
export function signBundle(payload: BundlePayload, privateKeyPem: string): SignedBundle {
  const key = createPrivateKey(privateKeyPem);
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const publicKey = createPublicKey(key).export({ format: 'jwk' }).x ?? '';
  return {
    payload: encoded,
    signature: sign(null, Buffer.from(encoded), key).toString('base64url'),
    keyId: keyIdOf(publicKey),
  };
}

/**
 * Checks a bundle's signature against the trusted keys, then validates its payload. The signature
 * covers the encoded payload exactly as received, so nothing is re-serialized before checking.
 *
 * @param bundle {SignedBundle} - received bundle
 * @param trustedKeys {string[]} - raw Ed25519 public keys, base64url
 * @returns {{ payload: BundlePayload } | { error: string }} - payload, or why it is refused
 */
export function verifyBundle(
  bundle: SignedBundle,
  trustedKeys: string[],
): { payload: BundlePayload } | { error: string } {
  const publicKey = trustedKeys.find((key) => keyIdOf(key) === bundle.keyId);
  if (!publicKey) return { error: 'unknown_key' };
  if (
    !verify(
      null,
      Buffer.from(bundle.payload),
      ed25519PublicKey(publicKey),
      Buffer.from(bundle.signature, 'base64url'),
    )
  ) {
    return { error: 'bad_signature' };
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(bundle.payload, 'base64url').toString('utf8'));
  } catch {
    return { error: 'invalid_payload' };
  }
  const parsed = bundlePayloadSchema.safeParse(decoded);
  return parsed.success ? { payload: parsed.data } : { error: 'invalid_payload' };
}
