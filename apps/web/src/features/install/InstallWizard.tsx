import { type ComponentType, useState } from 'react';
import { Logo } from '../../components/Logo/Logo.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import styles from './InstallWizard.module.css';
import { AdminStep } from './steps/AdminStep.tsx';
import { ChecksStep } from './steps/ChecksStep.tsx';
import { InstanceStep } from './steps/InstanceStep.tsx';
import { LanguageStep } from './steps/LanguageStep.tsx';
import { SummaryStep } from './steps/SummaryStep.tsx';
import { TokenStep } from './steps/TokenStep.tsx';
import { INSTALL_STEPS, type InstallForm, type InstallStep, type StepProps } from './types.ts';

const STEP_COMPONENTS: Record<InstallStep, ComponentType<StepProps>> = {
  language: LanguageStep,
  token: TokenStep,
  checks: ChecksStep,
  admin: AdminStep,
  instance: InstanceStep,
  summary: SummaryStep,
};

/**
 * Builds the initial form, prefilled from the browser where sensible
 *
 * @returns {InstallForm} - empty credentials, default instance settings
 */
function initialForm(): InstallForm {
  return {
    token: '',
    admin: { email: '', password: '' },
    instance: {
      name: 'Almanach',
      publicUrl: window.location.origin,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    },
  };
}

/**
 * First-run installation wizard, in the spirit of CMS installers
 *
 * @returns {JSX.Element} - the wizard page
 */
export function InstallWizard() {
  const { t } = useI18n();
  const [form, setForm] = useState(initialForm);
  const [index, setIndex] = useState(0);
  const step = INSTALL_STEPS[index] ?? 'language';
  const Step = STEP_COMPONENTS[step];

  const props: StepProps = {
    form,
    update: (patch) => setForm((current) => ({ ...current, ...patch })),
    next: () => setIndex((current) => Math.min(current + 1, INSTALL_STEPS.length - 1)),
    back: () => setIndex((current) => Math.max(current - 1, 0)),
    goTo: (target) => setIndex(INSTALL_STEPS.indexOf(target)),
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Logo />
        <nav aria-label={t('install.title')} className={styles.progress}>
          <ol className={styles.bars}>
            {INSTALL_STEPS.map((name, position) => (
              <li
                key={name}
                className={`${styles.bar} ${position <= index ? styles.barDone : ''} ${position === index ? styles.barCurrent : ''}`}
                aria-current={position === index ? 'step' : undefined}
              >
                <span className="visually-hidden">{t(`install.step.${name}`)}</span>
              </li>
            ))}
          </ol>
          <span className={styles.stepLabel}>
            {t('install.stepOf', { current: index + 1, total: INSTALL_STEPS.length })} ·{' '}
            {t(`install.step.${step}`)}
          </span>
        </nav>
      </header>
      <main className={styles.main}>
        <Step key={step} {...props} />
      </main>
    </div>
  );
}
