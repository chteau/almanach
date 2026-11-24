import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import type { Database } from '../../db/client.ts';
import { PACKS_DIR, PackRegistry } from './packs.ts';
import { BUNDLE_FORMAT, generateSigningKeys, signBundle } from './signing.ts';
import { PackUpdates } from './updates.ts';

describe('signed pack updates and the minimum Almanach version', () => {
  test('an instance too old refuses the bundle and keeps the pack in place', async () => {
    const packs = await PackRegistry.load();
    const before = packs.get('FR');
    const keys = generateSigningKeys();
    const frYaml = await Bun.file(resolve(PACKS_DIR, 'fr/pack.yaml')).text();
    const bundle = signBundle(
      {
        format: BUNDLE_FORMAT,
        country: 'FR',
        sequence: 7,
        createdAt: '2026-11-24T10:00:00.000Z',
        files: { 'pack.yaml': `${frYaml}\nminAppVersion: "3.0.0"\nfieldFromTheFuture: 1\n` },
      },
      keys.privateKey,
    );
    // Refused before any database access: nothing is stored.
    const updates = new PackUpdates({} as Database, packs, [keys.publicKey], undefined, '2.5.0');
    expect(await updates.import(bundle, null)).toEqual({
      error: 'app_too_old',
      minAppVersion: '3.0.0',
      message: 'Country pack FR requires Almanach 3.0.0 or later; this instance runs 2.5.0',
    });
    expect(packs.get('FR')).toBe(before);
  });
});
