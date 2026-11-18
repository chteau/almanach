import { LOCALES, type Locale } from '@almanach/shared';
import type { en } from './locales/en.ts';

export type MessageKey = keyof typeof en;
/** A complete catalogue: every key of the English reference, nothing more. */
export type Messages = Record<MessageKey, string>;
export type MessageParams = Record<string, string | number>;

/**
 * Picks the best supported locale from the browser's preferences
 *
 * @param preferred {readonly string[]} - BCP 47 tags in order of preference, e.g. navigator.languages
 * @returns {Locale} - first supported match, English otherwise
 */
export function detectLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    const match = LOCALES.find((locale) => locale === base);
    if (match) return match;
  }
  return 'en';
}

/**
 * Fills {placeholders} in a message
 *
 * @param template {string} - message containing {name} placeholders
 * @param params {MessageParams | undefined} - values to insert
 * @returns {string} - the formatted message; unknown placeholders are left untouched
 */
export function format(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}
