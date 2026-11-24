import type { Mission } from '@almanach/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Badge } from '../../components/Badge/Badge.tsx';
import { ButtonLink } from '../../components/Button/ButtonLink.tsx';
import { DangerAction, DangerZone } from '../../components/DangerZone/DangerZone.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { PageHeader } from '../../components/PageHeader/PageHeader.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { api } from '../../lib/api.ts';
import { formatDate, formatMoney } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import { describeError } from '../install/errors.ts';

/**
 * Mission record (P10): pricing, dates, client and end client, deletion
 *
 * @returns {JSX.Element} - the page
 */
export function MissionDetailPage() {
  const { id = '' } = useParams();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { data, error, reload } = useResource<{ mission: Mission }>(`/api/missions/${id}`);
  const [failure, setFailure] = useState<string>();

  if (error !== undefined) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Skeleton />;
  const { mission } = data;

  /**
   * Deletes the mission after confirmation
   *
   * @returns {Promise<void>} - resolves when done
   */
  async function remove(): Promise<void> {
    try {
      await api(`/api/missions/${mission.id}`, { method: 'DELETE' });
      navigate('/missions', { replace: true });
    } catch (failed) {
      setFailure(describeError(failed, t));
    }
  }

  const facts: [string, string][] = [
    [t('missions.billing'), t(`missions.billing.${mission.billing}`)],
    [t(`missions.rate.${mission.billing}`), formatMoney(mission.rateCents, mission.currency, locale)],
    [
      t('missions.budget'),
      mission.budgetCents === null ? '—' : formatMoney(mission.budgetCents, mission.currency, locale),
    ],
    [t('missions.start'), formatDate(mission.startDate, locale)],
    [t('missions.end'), mission.endDate ? formatDate(mission.endDate, locale) : '—'],
    [t('missions.endClient'), mission.endClient ?? '—'],
  ];

  return (
    <>
      <PageHeader
        width="narrow"
        title={mission.name}
        subtitle={
          <>
            <Link to={`/clients/${mission.clientId}`}>{mission.clientName}</Link> ·{' '}
            <Badge>{t(`missions.status.${mission.status}`)}</Badge>
          </>
        }
      >
        <ButtonLink to={`/missions/${mission.id}/edit`} variant="primary">
          {t('common.edit')}
        </ButtonLink>
        <ButtonLink
          to={`/documents/new?type=invoice&client=${mission.clientId}&mission=${mission.id}`}
          variant="ghost"
        >
          {t('documents.new.invoice')}
        </ButtonLink>
        <ButtonLink
          to={`/documents/new?type=quote&client=${mission.clientId}&mission=${mission.id}`}
          variant="ghost"
        >
          {t('documents.new.quote')}
        </ButtonLink>
      </PageHeader>
      <div className={form.form}>
        {failure && (
          <Notice tone="error" live>
            {failure}
          </Notice>
        )}
        <section className={form.section} aria-label={t('missions.section.pricing')}>
          <dl className={form.facts}>
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        {mission.notes && (
          <section className={form.section} aria-labelledby="mission-notes">
            <h2 id="mission-notes">{t('clients.notes')}</h2>
            <p className={form.summary}>{mission.notes}</p>
          </section>
        )}
        <DangerZone>
          <DangerAction
            label={t('missions.delete.label')}
            consequence={t('missions.delete.body')}
            actionLabel={t('common.delete')}
            confirmTitle={t('missions.delete.title', { name: mission.name })}
            onConfirm={() => void remove()}
          />
        </DangerZone>
      </div>
    </>
  );
}
