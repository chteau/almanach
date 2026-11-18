import { LOCALES, type Locale } from '@almanach/shared';
import { NavLink } from 'react-router';
import { NAV_ITEMS } from '../../components/AppShell/AppShell.tsx';
import { Button } from '../../components/Button/Button.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { PageHeader } from '../../components/PageHeader/PageHeader.tsx';
import list from '../../components/RowList/RowList.module.css';
import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { useAuth, useMe } from '../auth/AuthProvider.tsx';

/**
 * Phone menu listing every section that does not fit in the bottom tab bar, plus language and sign-out
 *
 * @returns {JSX.Element} - the page
 */
export function MenuPage() {
  const { t, locale, setLocale } = useI18n();
  const { logout } = useAuth();
  const me = useMe();
  return (
    <>
      <PageHeader title={t('nav.menu')} />
      <ul className={list.list}>
        {[
          ...NAV_ITEMS.filter((item) => !item.primary),
          { to: '/notifications', label: 'nav.notifications' as const },
        ].map((item) => (
          <li key={item.to} className={list.item}>
            <NavLink to={item.to} className={list.row}>
              <span className={list.primary}>
                <strong>{t(item.label)}</strong>
              </span>
            </NavLink>
          </li>
        ))}
      </ul>
      <section className={form.section} aria-label={me.email}>
        <SelectField
          label={t('nav.language')}
          value={locale}
          onChange={(event) => setLocale(event.target.value as Locale)}
        >
          {LOCALES.map((code) => (
            <option key={code} value={code}>
              {t(`lang.${code}`)}
            </option>
          ))}
        </SelectField>
        <p className={form.summary}>{me.email}</p>
        <Button variant="ghost" onClick={() => void logout()}>
          {t('nav.logout')}
        </Button>
      </section>
    </>
  );
}
