/**
 * Creates an Ed25519 key pair for signing country packs.
 * Usage: bun apps/server/src/cli/pack-keygen.ts <private-key-file>
 * The private key is written with mode 0600; put the printed public key in PACK_PUBLIC_KEYS.
 */
import { chmod } from 'node:fs/promises';
import { generateSigningKeys, keyIdOf } from '../features/packs/signing.ts';

const target = process.argv[2];
if (!target) {
  console.error('Usage: bun apps/server/src/cli/pack-keygen.ts <private-key-file>');
  process.exit(1);
}
if (await Bun.file(target).exists()) {
  console.error(`${target} already exists; refusing to overwrite a key.`);
  process.exit(1);
}
const { publicKey, privateKey } = generateSigningKeys();
await Bun.write(target, privateKey);
await chmod(target, 0o600);
console.log(`Private key written to ${target} (keep it offline).`);
console.log(`Public key (PACK_PUBLIC_KEYS): ${publicKey}`);
console.log(`Key id: ${keyIdOf(publicKey)}`);
