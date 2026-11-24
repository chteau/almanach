import { ONBOARDING_STEPS, type OnboardingStep, type PackMeta, profileSchema } from '@almanach/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Logo } from '../../components/Logo/Logo.tsx';
import { StatusScreen } from '../../components/StatusScreen/StatusScreen.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { api } from '../../lib/api.ts';
import { useAuth, useMe } from '../auth/AuthProvider.tsx';
import wizard from '../install/InstallWizard.module.css';
import { emptyForm, type OnboardingForm, toProfile } from './form.ts';
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
 * The saved profile is changed later from Settings → Profile and situation.
 *
 * @returns {JSX.Element} - the wizard
 */
export function OnboardingPage() {
  const { t } = useI18n();
  const me = useMe();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [packs, setPacks] = useState<PackMeta[]>();
  const [form, setForm] = useState(() => emptyForm(me));
  const [step, setStep] = useState<OnboardingStep>('country');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
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
  }, []);

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
    navigate('/', { replace: true });
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
