import type { Mission } from '@almanach/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Badge } from '../../components/Badge/Badge.tsx';
import buttonStyles from '../../components/Button/Button.module.css';
import { Button } from '../../components/Button/Button.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog.tsx';
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
  const [confirmDelete, setConfirmDelete] = useState(false);
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
    setConfirmDelete(false);
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
        title={mission.name}
        subtitle={
          <>
            <Link to={`/clients/${mission.clientId}`}>{mission.clientName}</Link> ·{' '}
            <Badge>{t(`missions.status.${mission.status}`)}</Badge>
          </>
        }
      >
        <Link
          to={`/missions/${mission.id}/edit`}
          className={`${buttonStyles.button} ${buttonStyles.primary}`}
        >
          {t('common.edit')}
        </Link>
        <Link
          to={`/documents/new?type=invoice&client=${mission.clientId}&mission=${mission.id}`}
          className={`${buttonStyles.button} ${buttonStyles.ghost}`}
        >
          {t('documents.new.invoice')}
        </Link>
        <Link
          to={`/documents/new?type=quote&client=${mission.clientId}&mission=${mission.id}`}
          className={`${buttonStyles.button} ${buttonStyles.ghost}`}
        >
          {t('documents.new.quote')}
        </Link>
        <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
          {t('common.delete')}
        </Button>
      </PageHeader>
      <div className={form.form}>
        {failure && <Notice tone="error">{failure}</Notice>}
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
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title={t('missions.delete.title', { name: mission.name })}
        body={t('missions.delete.body')}
        confirmLabel={t('common.delete')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}
