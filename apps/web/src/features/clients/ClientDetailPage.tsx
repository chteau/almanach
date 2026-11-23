import { type Client, formatMoney, type Mission, vatSituation } from '@almanach/shared';
import { type ReactNode, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Badge } from '../../components/Badge/Badge.tsx';
import buttonStyles from '../../components/Button/Button.module.css';
import { Button } from '../../components/Button/Button.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { PageHeader } from '../../components/PageHeader/PageHeader.tsx';
import list from '../../components/RowList/RowList.module.css';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { ApiError, api } from '../../lib/api.ts';
import { countryName, formatDate } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import { describeError } from '../install/errors.ts';
import { DevBadge } from '../linked/TestData.tsx';
import { useProfile } from '../profile/useProfile.ts';

/**
 * Client record (P08): details, VAT situation, missions, archive and delete (S-094, S-095, S-105)
 *
 * @returns {JSX.Element} - the page
 */
export function ClientDetailPage() {
  const { id = '' } = useParams();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const profile = useProfile();
  const { data, error, reload } = useResource<{
    client: Client;
    missionCount: number;
    receipts: {
      id: string;
      date: string;
      amountCents: number;
      currency: string;
      reference: string | null;
      livemode: boolean | null;
    }[];
  }>(`/api/clients/${id}`);
  const missions = useResource<{ missions: Mission[] }>('/api/missions');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [failure, setFailure] = useState<string>();

  if (error !== undefined) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Skeleton />;
  const { client, receipts } = data;
  const own = (missions.data?.missions ?? []).filter((mission) => mission.clientId === client.id);
  const situation = profile ? vatSituation(profile.country, client) : undefined;

  /**
   * Archives or restores the client
   *
   * @returns {Promise<void>} - resolves when done
   */
  async function toggleArchive(): Promise<void> {
    try {
      await api(`/api/clients/${client.id}/archive${client.archived ? '?undo=1' : ''}`, { method: 'POST' });
      reload();
    } catch (failed) {
      setFailure(describeError(failed, t));
    }
  }

  /**
   * Deletes the client, or explains that only archiving is possible once it has history
   *
   * @returns {Promise<void>} - resolves when done
   */
  async function remove(): Promise<void> {
    setConfirmDelete(false);
    try {
      await api(`/api/clients/${client.id}`, { method: 'DELETE' });
      navigate('/clients', { replace: true });
    } catch (failed) {
      setFailure(
        failed instanceof ApiError && failed.status === 409
          ? t('clients.delete.blocked')
          : describeError(failed, t),
      );
    }
  }

  const facts: [string, string][] = [
    [t('clients.kind'), t(`clients.kind.${client.kind}`)],
    [t('clients.email'), client.email ?? '—'],
    [t('clients.phone'), client.phone ?? '—'],
    [t('clients.address'), client.address ?? '—'],
    [t('clients.country'), countryName(client.country, locale)],
    [t('clients.vat'), client.vatNumber ?? '—'],
    [t('clients.siret'), client.siret ?? '—'],
    [t('clients.language'), t(`lang.${client.language}`)],
    [t('clients.currency'), client.currency],
    [t('clients.terms'), t('clients.terms.days', { days: client.paymentTermsDays })],
  ];

  return (
    <>
      <PageHeader title={client.name} subtitle={client.archived ? t('clients.archived.notice') : undefined}>
        <Link to={`/clients/${client.id}/edit`} className={`${buttonStyles.button} ${buttonStyles.primary}`}>
          {t('common.edit')}
        </Link>
        {!client.archived && (
          <Link
            to={`/documents/new?type=invoice&client=${client.id}`}
            className={`${buttonStyles.button} ${buttonStyles.ghost}`}
          >
            {t('documents.new.invoice')}
          </Link>
        )}
        <Button variant="ghost" onClick={() => void toggleArchive()}>
          {client.archived ? t('clients.unarchive') : t('clients.archive')}
        </Button>
        <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
          {t('common.delete')}
        </Button>
      </PageHeader>
      <div className={form.form}>
        {failure && <Notice tone="error">{failure}</Notice>}
        {client.stripeDeletedAt && <Notice tone="warn">{t('clients.stripe.deleted')}</Notice>}
        {situation && situation !== 'domestic' && (
          <Notice tone={situation === 'eu_b2b_missing_vat' ? 'warn' : 'info'}>{t(`vat.${situation}`)}</Notice>
        )}
        <section className={form.section} aria-labelledby="client-facts">
          <h2 id="client-facts" className="visually-hidden">
            {t('clients.section.identity')}
          </h2>
          <dl className={form.facts}>
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        {client.contacts.length > 0 && (
          <section className={form.section} aria-labelledby="client-contacts">
            <h2 id="client-contacts">{t('clients.contacts')}</h2>
            <dl className={form.facts}>
              {client.contacts.map((contact) => (
                <div key={`${contact.name}-${contact.email}`}>
                  <dt>
                    {contact.role ?? t('clients.contacts')}{' '}
                    {contact.billing && <Badge tone="ok">{t('clients.contact.billing.short')}</Badge>}
                  </dt>
                  <dd>{[contact.name, contact.email, contact.phone].filter(Boolean).join('\n')}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        {client.notes && (
          <section className={form.section} aria-labelledby="client-notes">
            <h2 id="client-notes">{t('clients.notes')}</h2>
            <p className={form.summary}>{client.notes}</p>
          </section>
        )}
        {receipts.length > 0 && (
          <section aria-labelledby="client-receipts">
            <PageHeaderLite id="client-receipts" title={t('clients.receipts')} />
            <ul className={list.list}>
              {receipts.map((receipt) => (
                <li
                  key={receipt.id}
                  className={receipt.livemode === false ? `${list.item} ${list.test}` : list.item}
                >
                  <div className={list.row}>
                    <span className={list.primary}>
                      <strong>{formatMoney(receipt.amountCents, receipt.currency, locale)}</strong>
                    </span>
                    <span className={list.secondary}>{formatDate(receipt.date, locale)}</span>
                    <span>{receipt.reference ?? ''}</span>
                    <span className={list.badges}>
                      <Badge>Stripe</Badge>
                      {receipt.livemode === false && <DevBadge />}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
        <section aria-labelledby="client-missions">
          <PageHeaderLite id="client-missions" title={t('nav.missions')}>
            {!client.archived && (
              <Link
                to={`/missions/new?client=${client.id}`}
                className={`${buttonStyles.button} ${buttonStyles.ghost}`}
              >
                {t('missions.new')}
              </Link>
            )}
          </PageHeaderLite>
          {own.length === 0 ? (
            <p className={list.count}>{t('clients.missions.empty')}</p>
          ) : (
            <ul className={list.list}>
              {own.map((mission) => (
                <li key={mission.id} className={list.item}>
                  <Link to={`/missions/${mission.id}`} className={list.row}>
                    <span className={list.primary}>
                      <strong>{mission.name}</strong>
                    </span>
                    <span className={list.secondary}>{formatDate(mission.startDate, locale)}</span>
                    <span />
                    <span className={list.badges}>
                      <Badge>{t(`missions.status.${mission.status}`)}</Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title={t('clients.delete.title', { name: client.name })}
        body={t('clients.delete.body')}
        confirmLabel={t('common.delete')}
        danger
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

/**
 * Section heading with actions, smaller than the page title
 *
 * @param props {{ id: string; title: string; children?: ReactNode }} - heading id, text and actions
 * @returns {JSX.Element} - the heading row
 */
export function PageHeaderLite({ id, title, children }: { id: string; title: string; children?: ReactNode }) {
  return (
    <div className={list.toolbar}>
      <h2 id={id} className={list.sectionTitle}>
        {title}
      </h2>
      <div className={form.actions}>{children}</div>
    </div>
  );
}
