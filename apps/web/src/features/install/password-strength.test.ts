import { expect, test } from 'bun:test';
import { passwordStrength } from './password-strength.ts';

test('rates passwords', () => {
  expect(passwordStrength('short', 'lea@example.com')).toBe('weak');
  expect(passwordStrength('abcdefghijkl', 'lea@example.com')).toBe('fair');
  expect(passwordStrength('Abcdefgh1jkl', 'lea@example.com')).toBe('strong');
  expect(passwordStrength('a quiet morning walk', 'lea@example.com')).toBe('strong');
});
