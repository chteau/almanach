import { LOCALES, type Locale } from '@almanach/shared';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useAuth, useMe } from '../../features/auth/AuthProvider.tsx';
import { activateCompany, useCompanies } from '../../features/companies/useCompanies.ts';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import type { MessageKey } from '../../i18n/messages.ts';
import { setDateRegion } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import { Logo } from '../Logo/Logo.tsx';
import { SearchDialog } from '../SearchDialog/SearchDialog.tsx';
import { UpdateBanner } from '../UpdateBanner/UpdateBanner.tsx';
import styles from './AppShell.module.css';

const SETTINGS_ICON =
  'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19 12l2-1-2-4-2 1-2-2V4h-4v2L9 7 7 6 5 10l2 1v2l-2 1 2 4 2-1 2 2v2h4v-2l2-1 2 1 2-4-2-1z';

/**
 * Main navigation. Every entry is in the desktop sidebar; on phones only `primary` entries are tabs and
 * the rest are reached from the menu page.
 */
export const NAV_ITEMS: {
  to: string;
  label: MessageKey;
  /** Shorter label for the phone tab bar. */
  short?: MessageKey;
  icon: string;
  primary?: boolean;
}[] = [
  {
    to: '/',
    label: 'nav.dashboard',
    short: 'nav.home',
    icon: 'M4 13h6V4H4zM14 20h6v-9h-6zM4 20h6v-3H4zM14 7h6V4h-6z',
    primary: true,
  },
  { to: '/calendar', label: 'nav.calendar', icon: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5', primary: true },
  {
    to: '/clients',
    label: 'nav.clients',
    icon: 'M4 19c0-3 3.5-5 8-5s8 2 8 5M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
    primary: true,
  },
  { to: '/missions', label: 'nav.missions', icon: 'M4 7h16v12H4zM9 7V4h6v3' },
  { to: '/time', label: 'nav.time', icon: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2' },
  { to: '/quotes', label: 'nav.quotes', icon: 'M6 3h9l3 3v15H6zM9 10h6M9 14h6M9 18h3' },
  {
    to: '/invoices',
    label: 'nav.invoices',
    icon: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
    primary: true,
  },
  { to: '/payments', label: 'nav.payments', icon: 'M3 7h18v10H3zM3 11h18M7 15h3' },
  { to: '/expenses', label: 'nav.expenses', icon: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 9h6M12 7v8' },
  { to: '/vault', label: 'nav.vault', icon: 'M4 5h16v14H4zM12 10v4M9 12h6' },
  { to: '/thresholds', label: 'nav.thresholds', icon: 'M4 20h16M6 16l4-5 3 3 5-7' },
  {
    to: '/settings',
    label: 'nav.settings',
    icon: SETTINGS_ICON,
  },
];

const MENU_ICON = 'M4 7h16M4 12h16M4 17h16';

/**
 * Authenticated layout: side navigation on wide screens, bottom tab bar on phones
 *
 * @returns {JSX.Element} - the layout with the current page in its outlet
 */
export function AppShell() {
  const { t, locale, setLocale } = useI18n();
  const { logout } = useAuth();
  const me = useMe();
  const location = useLocation();
  const inbox = useResource<{ notifications: { read: boolean }[] }>('/api/notifications');
  const unread = inbox.data?.notifications.filter((item) => !item.read).length ?? 0;
  const [searching, setSearching] = useState(false);
  const companies = useCompanies().data;
  // Dates follow the country of the active company on every page, set before the pages below render.
  const country = companies?.companies.find((company) => company.id === companies.active)?.country;
  if (country !== undefined) setDateRegion(country);

  useEffect(() => {
    /**
     * Opens the search with Ctrl/Cmd + K
     *
     * @param event {KeyboardEvent} - key press
     * @returns {void} - nothing
     */
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const { reload } = inbox;
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh the unread count on every navigation
  useEffect(() => {
    reload();
  }, [location.pathname, reload]);

  return (
    <div className={styles.shell}>
      <a href="#main" className={styles.skip}>
        {t('nav.skip')}
      </a>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <Logo />
        </div>
        <nav aria-label={t('nav.main')} className={styles.nav}>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={item.primary ? styles.link : `${styles.link} ${styles.secondaryLink}`}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.icon}>
                <path d={item.icon} />
              </svg>
              {item.short ? (
                <>
                  <span className={styles.full}>{t(item.label)}</span>
                  <span className={styles.short}>{t(item.short)}</span>
                </>
              ) : (
                <span>{t(item.label)}</span>
              )}
            </NavLink>
          ))}
          <NavLink to="/menu" className={`${styles.link} ${styles.menuLink}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.icon}>
              <path d={MENU_ICON} />
            </svg>
            <span>{t('nav.menu')}</span>
          </NavLink>
        </nav>
        <div className={styles.account}>
          <button
            type="button"
            className={styles.bell}
            onClick={() => setSearching(true)}
            aria-label={t('search.open')}
            aria-keyshortcuts="Control+K Meta+K"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.icon}>
              <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14M20 20l-4-4" />
            </svg>
            <span className={styles.bellLabel}>{t('search.open')}</span>
          </button>
          <NavLink
            to="/notifications"
            className={styles.bell}
            aria-label={
              unread > 0 ? t('nav.notifications.unread', { count: unread }) : t('nav.notifications')
            }
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.icon}>
              <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0" />
            </svg>
            <span className={styles.bellLabel}>{t('nav.notifications')}</span>
            {unread > 0 && <span className={styles.count}>{unread > 99 ? '99+' : unread}</span>}
          </NavLink>
          <NavLink
            to="/settings"
            className={`${styles.bell} ${styles.settingsShortcut}`}
            aria-label={t('nav.settings')}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.icon}>
              <path d={SETTINGS_ICON} />
            </svg>
          </NavLink>
          {companies && companies.companies.length > 1 && (
            <label className={styles.language}>
              <span className="visually-hidden">{t('companies.switch')}</span>
              <select value={companies.active} onChange={(event) => void activateCompany(event.target.value)}>
                {companies.companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className={styles.language}>
            <span className="visually-hidden">{t('nav.language')}</span>
            <select value={locale} onChange={(event) => setLocale(event.target.value as Locale)}>
              {LOCALES.map((code) => (
                <option key={code} value={code}>
                  {t(`lang.${code}`)}
                </option>
              ))}
            </select>
          </label>
          <span className={styles.email} title={me.email}>
            {me.email}
          </span>
          <button type="button" className={styles.logout} onClick={() => void logout()}>
            {t('nav.logout')}
          </button>
        </div>
      </aside>
      <SearchDialog open={searching} onClose={() => setSearching(false)} />
      <main id="main" className={styles.main}>
        <UpdateBanner />
        <Outlet />
      </main>
    </div>
  );
}
