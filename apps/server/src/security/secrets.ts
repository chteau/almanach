import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

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
