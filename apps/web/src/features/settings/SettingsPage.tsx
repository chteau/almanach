import type { PackMeta, Profile } from '@almanach/shared';
import { Link } from 'react-router';
import { Badge } from '../../components/Badge/Badge.tsx';
import buttonStyles from '../../components/Button/Button.module.css';
import form from '../../components/FormPage/FormPage.module.css';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { PageHeader } from '../../components/PageHeader/PageHeader.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { formatDate } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import { useMe } from '../auth/AuthProvider.tsx';
import { CompaniesSettings } from '../companies/CompaniesSettings.tsx';
import styles from '../planning/Planning.module.css';
import { RemindersSettings } from '../planning/RemindersSettings.tsx';
import { BillingSettings } from './BillingSettings.tsx';
import { DataSettings } from './DataSettings.tsx';
import { ExternalSourcesSettings } from './ExternalSourcesSettings.tsx';
import { FederationSettings } from './FederationSettings.tsx';
import { PackAdmin } from './PackAdmin.tsx';
import { SecuritySettings } from './SecuritySettings.tsx';
import { SituationSettings } from './SituationSettings.tsx';
import { StripeSettings } from './StripeSettings.tsx';
import { SystemSettings } from './SystemSettings.tsx';
import { TokensSettings } from './TokensSettings.tsx';

/**
 * Settings (P20): profile, country pack and its sources, security, reminders and calendar feed
 *
 * @returns {JSX.Element} - the page
 */
export function SettingsPage() {
  const { t, locale } = useI18n();
  const me = useMe();
  const { data, error, reload } = useResource<{
    profile: Profile;
    pack: PackMeta | null;
    rulesYears: number[];
  }>('/api/profile');

  return (
    <>
      <PageHeader title={t('nav.settings')} />
      <div className={form.form}>
        {error !== undefined && <LoadError error={error} onRetry={reload} />}
        {!data && error === undefined && <Skeleton rows={3} />}
        {data && (
          <section className={form.section} aria-labelledby="profile-title">
            <div className={styles.sectionHead}>
              <h2 id="profile-title" className={styles.sectionTitle}>
                {t('settings.profile')}
              </h2>
              <Link to="/settings/profile" className={`${buttonStyles.button} ${buttonStyles.ghost}`}>
                {t('common.edit')}
              </Link>
            </div>
            <dl className={form.facts}>
              <div>
                <dt>{t('settings.company')}</dt>
                <dd>{data.profile.company.name}</dd>
              </div>
              <div>
                <dt>{t('settings.status')}</dt>
                <dd>
                  {data.pack?.statuses.find((status) => status.id === data.profile.status)?.label[locale] ??
                    t('settings.generic')}
                </dd>
              </div>
              <div>
                <dt>{t('settings.activityStart')}</dt>
                <dd>{formatDate(data.profile.activityStart, locale)}</dd>
              </div>
              <div>
                <dt>{t('settings.currency')}</dt>
                <dd>{data.profile.currency}</dd>
              </div>
            </dl>
          </section>
        )}
        {data?.profile && <SituationSettings />}
        {data?.profile && <BillingSettings />}
        {data?.profile && <StripeSettings />}
        {data?.profile && <FederationSettings />}
        {data?.profile && <ExternalSourcesSettings />}
        <CompaniesSettings />
        {data?.pack && (
          <section className={form.section} aria-labelledby="pack-title">
            <h2 id="pack-title" className={styles.sectionTitle}>
              {t('settings.pack')}
            </h2>
            <p className={styles.text}>
              <strong>{data.pack.name[locale]}</strong>{' '}
              <Badge tone={data.pack.maturity === 'verified' ? 'ok' : 'warn'}>
                {t(`settings.maturity.${data.pack.maturity}`)}
              </Badge>
            </p>
            <p className={styles.caption}>{t(`settings.maturity.${data.pack.maturity}.body`)}</p>
            <p className={styles.caption}>
              {data.rulesYears.length > 0
                ? t('settings.rulesYears', { years: data.rulesYears.join(', ') })
                : t('settings.rulesYears.none')}
            </p>
            <p className={styles.caption}>{t('settings.sources')}</p>
          </section>
        )}
        {me.role === 'admin' && <PackAdmin />}
        {me.role === 'admin' && <SystemSettings />}
        <SecuritySettings />
        <TokensSettings />
        <RemindersSettings />
        <DataSettings />
      </div>
    </>
  );
}
