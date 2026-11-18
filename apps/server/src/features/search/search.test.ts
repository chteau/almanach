import { expect, test } from 'bun:test';
import { containsPattern } from './search.routes.ts';

test('search text is matched literally', () => {
  expect(containsPattern('F-2026')).toBe('%F-2026%');
  expect(containsPattern('100%_a\\b')).toBe('%100\\%\\_a\\\\b%');
});
