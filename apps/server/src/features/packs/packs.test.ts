import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PACKS_DIR, PackRegistry, PackTooNewError, parseCountryFiles, profileIssues } from './packs.ts';

const registry = await PackRegistry.load();
const fr = registry.get('FR');

describe('country packs', () => {
  test('the four bundled packs load and validate', () => {
    expect(registry.list().map((pack) => pack.country)).toEqual(['DE', 'FR', 'GB', 'US']);
    expect(registry.get('GB')?.fiscalYearStart).toBe('04-06');
  });

  test('accepts a consistent French profile', () => {
    const issues = profileIssues(
      {
        status: 'micro_bnc',
        declarationPeriod: 'quarterly',
        options: ['acre'],
        identifiers: { siret: '732 829 320 00074', vat: '' },
      },
      fr,
    );
    expect(issues).toEqual([]);
  });

  test('rejects a SIRET with a bad checksum, unknown status and foreign identifier', () => {
    const issues = profileIssues(
      {
        status: 'sarl',
        declarationPeriod: 'yearly',
        options: [],
        identifiers: { siret: '73282932000075', utr: '1' },
      },
      fr,
    ).map((issue) => `${issue.path}:${issue.message}`);
    expect(issues).toEqual([
      'status:unknown_status',
      'declarationPeriod:unknown_period',
      'identifiers.utr:unknown_identifier',
      'identifiers.siret:invalid_format',
    ]);
  });

  test('generic mode refuses pack-specific fields', () => {
    expect(
      profileIssues({ status: 'x', declarationPeriod: null, options: [], identifiers: {} }, undefined),
    ).toHaveLength(1);
    expect(
      profileIssues({ status: null, declarationPeriod: null, options: [], identifiers: {} }, undefined),
    ).toEqual([]);
  });
});

const frYaml = await Bun.file(resolve(PACKS_DIR, 'fr/pack.yaml')).text();

describe('minimum Almanach version of a pack', () => {
  test('a pack needing a newer version is refused with a clear message, before its new fields are read', () => {
    const files = { 'pack.yaml': `${frYaml}\nminAppVersion: "2.0.0"\nfieldFromTheFuture: true\n` };
    expect(() => parseCountryFiles('fr', files, '1.4.9')).toThrow(
      'Country pack fr requires Almanach 2.0.0 or later; this instance runs 1.4.9',
    );
    expect(() => parseCountryFiles('fr', files, '1.4.9')).toThrow(PackTooNewError);
  });

  test('the same or a newer version reads it', () => {
    const files = { 'pack.yaml': `${frYaml}\nminAppVersion: "2.0.0"\n` };
    expect(parseCountryFiles('fr', files, '2.0.0').meta.minAppVersion).toBe('2.0.0');
    expect(parseCountryFiles('fr', files, '2.1.0').meta.country).toBe('FR');
  });

  test('loading skips a pack that is too new and keeps the others', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'almanach-packs-'));
    try {
      await mkdir(join(dir, 'fr'));
      await mkdir(join(dir, 'xx'));
      await Bun.write(join(dir, 'fr/pack.yaml'), frYaml);
      await Bun.write(
        join(dir, 'xx/pack.yaml'),
        `${frYaml.replace('country: FR', 'country: XX')}\nminAppVersion: "999.0.0"\n`,
      );
      expect((await PackRegistry.load(dir)).list().map((pack) => pack.country)).toEqual(['FR']);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
