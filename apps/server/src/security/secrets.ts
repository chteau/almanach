import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Encrypts a secret at rest with AES-256-GCM
 *
 * @param plain {string} - secret to store
 * @param key {Buffer} - 32-byte key from SECRETS_KEY
 * @returns {string} - `v1.iv.tag.ciphertext`, each part base64url
 */
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data].map((part) => part.toString('base64url')).join('.');
}

/**
 * Decrypts a secret written by encryptSecret
 *
 * @param stored {string} - encrypted value
 * @param key {Buffer} - 32-byte key from SECRETS_KEY
 * @returns {string} - the secret
 * @throws {Error} - when the value was tampered with or the key changed
 */
export function decryptSecret(stored: string, key: Buffer): string {
  const [version, iv, tag, data] = stored.split('.');
  if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('invalid_secret');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

/**
 * Key of the document vault, derived from SECRETS_KEY so files and stored secrets never share a key
 *
 * @param key {Buffer} - SECRETS_KEY, 32 bytes
 * @returns {Buffer} - 32-byte AES key
 */
export function vaultKey(key: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', key, Buffer.alloc(0), 'almanach-vault-v1', 32));
}

/**
 * Encrypts a file with AES-256-GCM: "v1" | iv (12) | tag (16) | ciphertext
 *
 * @param plain {Uint8Array} - file content
 * @param key {Buffer} - 32-byte key (vaultKey)
 * @returns {Buffer} - versioned ciphertext
 */
export function encryptBytes(plain: Uint8Array, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from('v1'), iv, cipher.getAuthTag(), data]);
}

/**
 * Decrypts a file written by encryptBytes
 *
 * @param stored {Uint8Array} - versioned ciphertext
 * @param key {Buffer} - 32-byte key (vaultKey)
 * @returns {Buffer} - file content; throws when the key is wrong or the data altered
 */
export function decryptBytes(stored: Uint8Array, key: Buffer): Buffer {
  const bytes = Buffer.from(stored);
  if (bytes.subarray(0, 2).toString() !== 'v1' || bytes.length < 30) throw new Error('invalid_file');
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(2, 14));
  decipher.setAuthTag(bytes.subarray(14, 30));
  return Buffer.concat([decipher.update(bytes.subarray(30)), decipher.final()]);
}
