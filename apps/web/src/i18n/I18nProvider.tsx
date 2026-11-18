import { LOCALES, type Locale } from '@almanach/shared';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { de } from './locales/de.ts';
import { en } from './locales/en.ts';
import { fr } from './locales/fr.ts';
import { detectLocale, format, type MessageKey, type MessageParams, type Messages } from './messages.ts';

const CATALOGUES: Record<Locale, Messages> = { en, fr, de };
const STORAGE_KEY = 'almanach.locale';

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, params?: MessageParams) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

/**
 * Reads the locale remembered in this browser, if any
 *
 * @returns {Locale | null} - remembered locale, or null when absent or storage is blocked
 */
function rememberedLocale(): Locale | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return LOCALES.find((locale) => locale === value) ?? null;
  } catch {
    return null;
  }
}

/**
 * Provides the current locale and translation function to the tree
 *
 * @param props {{ children: ReactNode }} - wrapped application
 * @returns {JSX.Element} - the provider
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(
    () => rememberedLocale() ?? detectLocale(navigator.languages),
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage may be blocked; the choice still applies for this visit.
    }
  }, []);

  const value = useMemo<I18nValue>(
    () => ({ locale, setLocale, t: (key, params) => format(CATALOGUES[locale][key], params) }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Accesses the locale and the translation function
 *
 * @returns {I18nValue} - current locale, setter and t()
 */
export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>');
  return value;
}
