import type { PackMeta } from '@almanach/shared';
import { Badge } from '../../components/Badge/Badge.tsx';
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { SettingsSection } from '../../components/SettingsSection/SettingsSection.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { useResource } from '../../lib/useResource.ts';
import text from '../../styles/text.module.css';

/**
 * Country rules in use: the pack, how far it was checked, and the years it covers
 *
 * @returns {JSX.Element} - the section
 */
export function RulesSettings() {
  const { t, locale } = useI18n();
  const { data, error, reload } = useResource<{ pack: PackMeta | null; rulesYears: number[] }>(
    '/api/profile',
  );
  if (error !== undefined) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Skeleton rows={3} />;
  const { pack } = data;
  if (!pack)
    return <EmptyState inline title={t('settings.rules.none')} body={t('settings.rules.none.body')} />;
  return (
    <SettingsSection
      title={pack.name[locale]}
      description={t(`settings.maturity.${pack.maturity}.body`)}
      badge={
        <Badge tone={pack.maturity === 'verified' ? 'ok' : 'warn'}>
          {t(`settings.maturity.${pack.maturity}`)}
        </Badge>
      }
    >
      <p className={text.text}>
        {data.rulesYears.length > 0
          ? t('settings.rulesYears', { years: data.rulesYears.join(', ') })
          : t('settings.rulesYears.none')}
      </p>
      <p className={text.caption}>{t('settings.sources')}</p>
    </SettingsSection>
  );
}
