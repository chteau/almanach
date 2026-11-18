import { describe, expect, test } from 'bun:test';
import { installRequestSchema, isTimeZone, normalizeUrl, passwordIssues } from './install.ts';

const valid = {
  locale: 'fr',
  admin: { email: '  Lea@Example.com ', password: 'correct-horse-battery' },
  instance: { name: 'Mon almanach', publicUrl: 'https://almanach.example.com/', timezone: 'Europe/Paris' },
};

describe('passwordIssues', () => {
  test('accepts a long, varied password', () => {
    expect(passwordIssues('correct-horse-battery', 'lea@example.com')).toEqual([]);
  });

  test('flags short, repetitive and e-mail based passwords', () => {
    expect(passwordIssues('aaaa', 'lea@example.com')).toEqual(['too_short', 'too_simple']);
    expect(passwordIssues('lea-is-the-best-dev', 'lea@example.com')).toContain('contains_email');
  });
});

describe('installRequestSchema', () => {
  test('normalizes e-mail and URL', () => {
    const parsed = installRequestSchema.parse(valid);
    expect(parsed.admin.email).toBe('lea@example.com');
    expect(parsed.instance.publicUrl).toBe('https://almanach.example.com');
  });

  test('rejects unknown keys, bad protocol and unknown time zone', () => {
    expect(installRequestSchema.safeParse({ ...valid, role: 'admin' }).success).toBe(false);
    expect(
      installRequestSchema.safeParse({ ...valid, instance: { ...valid.instance, publicUrl: 'ftp://x.y' } })
        .success,
    ).toBe(false);
    expect(
      installRequestSchema.safeParse({ ...valid, instance: { ...valid.instance, timezone: 'Mars/Olympus' } })
        .success,
    ).toBe(false);
  });

  test('rejects a password containing the e-mail', () => {
    const result = installRequestSchema.safeParse({
      ...valid,
      admin: { email: 'lea@example.com', password: 'lea-is-the-best-dev' },
    });
    expect(result.success).toBe(false);
  });
});

describe('helpers', () => {
  test('isTimeZone and normalizeUrl', () => {
    expect(isTimeZone('Europe/London')).toBe(true);
    expect(isTimeZone('Nowhere/City')).toBe(false);
    expect(normalizeUrl('http://localhost:8080//')).toBe('http://localhost:8080');
  });
});
