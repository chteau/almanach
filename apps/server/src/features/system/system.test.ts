import { describe, expect, test } from 'bun:test';
import { compareVersions, parseRelease } from './system.ts';

describe('release check (S-273)', () => {
  test('compares versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.3')).toBeGreaterThan(0);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.9.9', '1.0.0')).toBeLessThan(0);
  });

  test('keeps only a well-formed tag and a GitHub link', () => {
    expect(
      parseRelease({
        tag_name: 'v1.2.3',
        html_url: 'https://github.com/chteau/almanach/releases/tag/v1.2.3',
      }),
    ).toEqual({
      version: '1.2.3',
      url: 'https://github.com/chteau/almanach/releases/tag/v1.2.3',
    });
    expect(parseRelease({ tag_name: '1.2.3', html_url: 'javascript:alert(1)' })).toBeNull();
    expect(parseRelease({ tag_name: 'latest', html_url: 'https://github.com/x' })).toBeNull();
    expect(parseRelease(null)).toBeNull();
  });
});
