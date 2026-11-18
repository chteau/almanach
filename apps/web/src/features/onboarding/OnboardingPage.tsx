import {
  ONBOARDING_STEPS,
  type OnboardingStep,
  type PackMeta,
  type Profile,
  profileSchema,
} from '@almanach/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Logo } from '../../components/Logo/Logo.tsx';
import { StatusScreen } from '../../components/StatusScreen/StatusScreen.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { api } from '../../lib/api.ts';
import { useAuth, useMe } from '../auth/AuthProvider.tsx';
import wizard from '../install/InstallWizard.module.css';
import { emptyForm, fromProfile, type OnboardingForm, toProfile } from './form.ts';
import { BankStep, CountryStep, IdentityStep, RevenueStep, StatusStep, SummaryStep } from './steps.tsx';

export interface OnboardingStepProps {
  form: OnboardingForm;
  pack: PackMeta | undefined;
  packs: PackMeta[];
  update: (patch: Partial<OnboardingForm>) => void;
  next: () => void;
  back: () => void;
}

/**
 * Onboarding wizard (P03): country pack, status, identity, bank, revenue already earned, summary.
 * Progress is saved on the server after each step so the person resumes where they stopped (S-032).
 * With `edit`, the same steps change the saved profile from the settings.
 *
 * @param props {{ edit?: boolean }} - true to edit the existing profile
 * @returns {JSX.Element} - the wizard
 */
export function OnboardingPage({ edit = false }: { edit?: boolean }) {
  const { t, locale } = useI18n();
  const me = useMe();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [packs, setPacks] = useState<PackMeta[]>();
  const [form, setForm] = useState(() => emptyForm(me));
  const [step, setStep] = useState<OnboardingStep>('country');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (edit) {
      Promise.all([api<{ packs: PackMeta[] }>('/api/packs'), api<{ profile: Profile }>('/api/profile')])
        .then(([packList, { profile }]) => {
          setPacks(packList.packs);
          setForm(fromProfile(profile, locale));
        })
        .catch(() => setFailed(true));
      return;
    }
    Promise.all([
      api<{ packs: PackMeta[] }>('/api/packs'),
      api<{ draft: { step: OnboardingStep; data: Partial<OnboardingForm> } | null }>('/api/onboarding'),
    ])
      .then(([packList, { draft }]) => {
        setPacks(packList.packs);
        if (draft) {
          setForm((current) => ({ ...current, ...draft.data }));
          setStep(draft.step);
        }
      })
      .catch(() => setFailed(true));
  }, [edit, locale]);

  if (failed) return <StatusScreen state="error" />;
  if (!packs) return <StatusScreen state="loading" />;

  const pack = packs.find((candidate) => candidate.country === form.country);
  const steps = ONBOARDING_STEPS.filter((name) => name !== 'status' || pack);
  const index = Math.max(0, steps.indexOf(step));

  /**
   * Moves to another step and saves the draft so it can be resumed
   *
   * @param target {OnboardingStep} - step to show
   * @returns {void} - nothing
   */
  function go(target: OnboardingStep): void {
    setStep(target);
    if (edit) return;
    void api('/api/onboarding', { method: 'PUT', body: { step: target, data: form } }).catch(() => undefined);
  }

  /**
   * Sends the profile; on success the person reaches the application
   *
   * @returns {Promise<void>} - resolves when done; throws the API error otherwise
   */
  async function finish(): Promise<void> {
    const payload = profileSchema.parse(toProfile(form, pack));
    await api('/api/profile', { method: 'PUT', body: payload });
    await refresh();
    navigate(edit ? '/settings' : '/', { replace: true });
  }

  const props: OnboardingStepProps = {
    form,
    pack,
    packs,
    update: (patch) => setForm((current) => ({ ...current, ...patch })),
    next: () => go(steps[index + 1] ?? 'summary'),
    back: () => go(steps[index - 1] ?? 'country'),
  };

  return (
    <div className={wizard.page}>
      <header className={wizard.header}>
        <Logo />
        <nav aria-label={t('onboarding.progress')} className={wizard.progress}>
          <ol className={wizard.bars}>
            {steps.map((name, position) => (
              <li
                key={name}
                className={`${wizard.bar} ${position <= index ? wizard.barDone : ''} ${position === index ? wizard.barCurrent : ''}`}
                aria-current={position === index ? 'step' : undefined}
              >
                <span className="visually-hidden">{t(`onboarding.step.${name}`)}</span>
              </li>
            ))}
          </ol>
          <span className={wizard.stepLabel}>
            {t('install.stepOf', { current: index + 1, total: steps.length })} ·{' '}
            {t(`onboarding.step.${step}`)}
          </span>
        </nav>
      </header>
      <main className={wizard.main}>
        {step === 'country' && <CountryStep key={step} {...props} />}
        {step === 'status' && <StatusStep key={step} {...props} />}
        {step === 'identity' && <IdentityStep key={step} {...props} />}
        {step === 'bank' && <BankStep key={step} {...props} />}
        {step === 'revenue' && <RevenueStep key={step} {...props} />}
        {step === 'summary' && <SummaryStep key={step} {...props} finish={finish} />}
      </main>
    </div>
  );
}
