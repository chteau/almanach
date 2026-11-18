/**
 * Signs a country pack directory into a bundle that instances can import.
 * Usage: bun apps/server/src/cli/pack-sign.ts <pack-dir> <private-key-file> <sequence> [notes]
 * Example: bun apps/server/src/cli/pack-sign.ts packs/fr keys/almanach.pem 3 "Taux 2027" > fr-3.json
 */
import { readdir } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { parseCountryFiles } from '../features/packs/packs.ts';
import { BUNDLE_FORMAT, bundlePayloadSchema, signBundle } from '../features/packs/signing.ts';

const [dir, keyFile, sequenceText, notes] = process.argv.slice(2);
const sequence = Number(sequenceText);
if (!dir || !keyFile || !Number.isInteger(sequence) || sequence < 1) {
  console.error(
    'Usage: bun apps/server/src/cli/pack-sign.ts <pack-dir> <private-key-file> <sequence> [notes]',
  );
  process.exit(1);
}
const files: Record<string, string> = {};
for (const name of await readdir(dir)) {
  if (name === 'pack.yaml' || /^\d{4}\.yaml$/.test(name))
    files[name] = await Bun.file(resolve(dir, name)).text();
}
// Same validation as the server: a broken pack is never signed.
const { meta } = parseCountryFiles(basename(dir), files);
const payload = bundlePayloadSchema.parse({
  format: BUNDLE_FORMAT,
  country: meta.country,
  sequence,
  createdAt: new Date().toISOString(),
  ...(notes ? { notes } : {}),
  files,
});
console.log(JSON.stringify(signBundle(payload, await Bun.file(keyFile).text())));
