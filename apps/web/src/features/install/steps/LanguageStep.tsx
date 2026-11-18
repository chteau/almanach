import { LOCALES } from '@almanach/shared';
import { useI18n } from '../../../i18n/I18nProvider.tsx';
import styles from '../InstallWizard.module.css';
import type { StepProps } from '../types.ts';
import { StepShell } from './StepShell.tsx';

/**
 * Step 1: choose the interface language of the installation
 *
 * @param props {StepProps} - wizard navigation
 * @returns {JSX.Element} - the step
 */
export function LanguageStep({ next }: StepProps) {
  const { t, locale, setLocale } = useI18n();

  return (
    <StepShell title={t('install.language.title')} body={t('install.language.body')} onSubmit={next}>
      <fieldset className={styles.choices}>
        <legend className="visually-hidden">{t('install.step.language')}</legend>
        {LOCALES.map((code) => (
          <label key={code} className={styles.choice}>
            <input
              type="radio"
              name="locale"
              value={code}
              checked={locale === code}
              onChange={() => setLocale(code)}
            />
            <span lang={code}>{t(`lang.${code}`)}</span>
          </label>
        ))}
      </fieldset>
    </StepShell>
  );
}
