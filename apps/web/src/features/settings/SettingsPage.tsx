import { type ReactNode, useEffect, useState } from 'react';
import { Link, Navigate, NavLink, useLocation, useParams } from 'react-router';
import { PageHeader } from '../../components/PageHeader/PageHeader.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { ActivitiesSettings } from '../activities/ActivitiesSettings.tsx';
import { useMe } from '../auth/AuthProvider.tsx';
import { CompaniesSettings } from '../companies/CompaniesSettings.tsx';
import { CalendarFeedSettings, RemindersSettings } from '../planning/RemindersSettings.tsx';
import { BillingSettings } from './BillingSettings.tsx';
import { DataSettings } from './DataSettings.tsx';
import { ExternalSourcesSettings } from './ExternalSourcesSettings.tsx';
import { FederationSettings } from './FederationSettings.tsx';
import { MailSettings } from './MailSettings.tsx';
import { PackAdmin } from './PackAdmin.tsx';
import { ProfileSettings } from './ProfileSettings.tsx';
import { RulesSettings } from './RulesSettings.tsx';
import { DevicesSettings, PasswordSettings, TwoFactorSettings } from './SecuritySettings.tsx';
import styles from './Settings.module.css';
import { SituationSettings } from './SituationSettings.tsx';
import { StripeSettings } from './StripeSettings.tsx';
import { SystemSettings } from './SystemSettings.tsx';
import { groupOf, legacyPanel, type SettingsPanel, visibleGroups } from './sections.ts';
import { TokensSettings } from './TokensSettings.tsx';

const DESKTOP = '(min-width: 900px)';

/** What each panel shows. */
const PANELS: Record<SettingsPanel, () => ReactNode> = {
  profile: () => (
    <>
      <ProfileSettings />
      <SituationSettings />
    </>
  ),
  companies: () => (
    <>
      <CompaniesSettings />
      <ActivitiesSettings />
    </>
  ),
  rules: () => <RulesSettings />,
  numbering: () => <BillingSettings part="numbering" />,
  pdf: () => <BillingSettings part="pdf" />,
  defaults: () => <BillingSettings part="defaults" />,
  stripe: () => <StripeSettings />,
  linked: () => <FederationSettings />,
  sources: () => <ExternalSourcesSettings />,
  assistants: () => <TokensSettings />,
  reminders: () => <RemindersSettings />,
  calendar: () => <CalendarFeedSettings />,
  email: () => <MailSettings />,
  password: () => <PasswordSettings />,
  'two-factor': () => <TwoFactorSettings />,
  devices: () => <DevicesSettings />,
  data: () => <DataSettings />,
  instance: () => <SystemSettings />,
  packs: () => <PackAdmin />,
};

/**
 * Tracks a CSS media query
 *
 * @param query {string} - media query
 * @returns {boolean} - whether it currently matches
 */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    /**
     * Follows the query when the window is resized
     *
     * @returns {void} - nothing
     */
    const onChange = (): void => setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/**
 * Settings navigation: groups and their panels
 *
 * @returns {JSX.Element} - the navigation
 */
function SettingsNav() {
  const { t } = useI18n();
  const me = useMe();
  return (
    <nav aria-label={t('settings.nav')} className={styles.nav}>
      {visibleGroups(me.role === 'admin').map((group) => (
        <div key={group.id} className={styles.group}>
          <h2 className={styles.groupTitle}>{t(`settings.group.${group.id}`)}</h2>
          <ul className={styles.links}>
            {group.panels.map((panel) => (
              <li key={panel}>
                <NavLink to={`/settings/${panel}`} className={styles.link}>
                  <span>{t(`settings.panel.${panel}`)}</span>
                  <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.chevron}>
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * Settings (P20): a side navigation of groups and panels on wide screens; on phones, the list of
 * panels first, then the chosen panel on its own screen with a way back
 *
 * @returns {JSX.Element} - the page
 */
export function SettingsPage() {
  const { t } = useI18n();
  const me = useMe();
  const { section } = useParams();
  const location = useLocation();
  const desktop = useMediaQuery(DESKTOP);
  const admin = me.role === 'admin';

  if (section === undefined) {
    const legacy = legacyPanel(location.hash);
    if (legacy && groupOf(legacy, admin)) return <Navigate to={`/settings/${legacy}`} replace />;
    if (desktop) return <Navigate to="/settings/profile" replace />;
    return (
      <>
        <PageHeader title={t('nav.settings')} width="narrow" />
        <SettingsNav />
      </>
    );
  }

  const group = groupOf(section, admin);
  if (!group) return <Navigate to="/settings" replace />;
  const panel = section as SettingsPanel;

  return (
    <div className={styles.layout}>
      {desktop && <SettingsNav />}
      <div className={styles.content}>
        {!desktop && (
          <Link to="/settings" className={styles.back}>
            <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.chevron}>
              <path d="M15 6l-6 6 6 6" />
            </svg>
            {t('nav.settings')}
          </Link>
        )}
        <PageHeader
          title={t(`settings.panel.${panel}`)}
          subtitle={t(`settings.group.${group.id}`)}
          width="narrow"
        />
        <div className={styles.panel}>{PANELS[panel]()}</div>
      </div>
    </div>
  );
}
