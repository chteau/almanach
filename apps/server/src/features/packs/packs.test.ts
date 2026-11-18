import { describe, expect, test } from 'bun:test';
import { PackRegistry, profileIssues } from './packs.ts';

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
