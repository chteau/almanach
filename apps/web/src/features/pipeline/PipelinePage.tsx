import { type Client, DEAL_STAGES, type DealStage, type DealView, parseAmount } from '@almanach/shared';
import { type SyntheticEvent, useState } from 'react';
import { Link } from 'react-router';
import { ActionBar } from '../../components/ActionBar/ActionBar.tsx';
import { Button } from '../../components/Button/Button.tsx';
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { PageHeader } from '../../components/PageHeader/PageHeader.tsx';
import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { SettingsSection } from '../../components/SettingsSection/SettingsSection.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { api } from '../../lib/api.ts';
import { formatDate, formatMoney } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import { useProfile } from '../profile/useProfile.ts';
import { useAction } from '../settings/useAction.ts';
import styles from './Pipeline.module.css';

interface DealList {
  deals: DealView[];
  followUpDays: number;
}

/**
 * Pipeline: deals by stage (columns on wide screens, a list on phones), a total per stage and currency
 *
 * @returns {JSX.Element} - the page
 */
export function PipelinePage() {
  const { t, locale } = useI18n();
  const { data, error, loading, reload } = useResource<DealList>('/api/deals');
  const clients = useResource<{ clients: Client[] }>('/api/clients').data?.clients ?? [];
  const currency = useProfile()?.currency ?? 'EUR';

  /**
   * Total of a stage, one figure per currency
   *
   * @param deals {DealView[]} - deals of the stage
   * @returns {string} - e.g. "12 000 € · 3 000 $"
   */
  const total = (deals: DealView[]): string => {
    const sums = new Map<string, number>();
    for (const deal of deals)
      if (deal.amountCents !== null)
        sums.set(deal.currency ?? currency, (sums.get(deal.currency ?? currency) ?? 0) + deal.amountCents);
    return [...sums].map(([code, cents]) => formatMoney(cents, code, locale)).join(' · ');
  };

  return (
    <>
      <PageHeader title={t('pipeline.title')} subtitle={t('pipeline.subtitle')} />
      {error !== undefined && <LoadError error={error} onRetry={reload} />}
      {loading && !data && <Skeleton rows={4} />}
      {data && (
        <div className={form.form}>
          <DealForm clients={clients} currency={currency} onSaved={reload} />
          {data.deals.length === 0 ? (
            <EmptyState title={t('pipeline.empty.title')} body={t('pipeline.empty.body')} />
          ) : (
            <div className={styles.board}>
              {DEAL_STAGES.map((stage) => {
                const deals = data.deals.filter((deal) => deal.stage === stage);
                const sum = total(deals);
                return (
                  <section key={stage} className={styles.column} aria-labelledby={`stage-${stage}`}>
                    <h2 id={`stage-${stage}`} className={styles.columnTitle}>
                      {t(`pipeline.stage.${stage}`)} ({deals.length}){sum && ` · ${sum}`}
                    </h2>
                    <ul className={styles.list}>
                      {deals.map((deal) => (
                        <li key={deal.id}>
                          <DealCard deal={deal} clients={clients} onSaved={reload} />
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
          <FollowUpDaysForm days={data.followUpDays} onSaved={reload} />
        </div>
      )}
    </>
  );
}

/**
 * Fields of a deal the API expects on PUT, from its view
 *
 * @param deal {DealView} - deal
 * @returns {Record<string, unknown>} - input
 */
function inputOf(deal: DealView): Record<string, unknown> {
  const {
    id: _id,
    name: _name,
    quoteNumber: _quote,
    closedOn: _closed,
    createdAt: _created,
    late: _late,
    events: _events,
    ...input
  } = deal;
  return input;
}

/**
 * One deal: who, amount, quote, next action; change of stage by a menu (keyboard friendly), follow-up done,
 * conversion of the prospect into a client, mission proposed once won
 *
 * @param props {{ deal: DealView; clients: Client[]; onSaved: () => void }} - deal, clients and refresh callback
 * @returns {JSX.Element} - the card
 */
function DealCard({ deal, onSaved }: { deal: DealView; clients: Client[]; onSaved: () => void }) {
  const { t, locale } = useI18n();
  const profile = useProfile();
  const [followUp, setFollowUp] = useState(false);
  const [values, setValues] = useState({ note: '', nextActionOn: '' });
  const action = useAction();

  const save = (path: string, method: 'PUT' | 'POST' | 'DELETE', body?: unknown) =>
    action.run(async () => {
      await api(path, { method, body });
      onSaved();
    });

  return (
    <article className={styles.card} aria-label={deal.title}>
      <p className={styles.cardTitle}>{deal.title}</p>
      <p className={styles.meta}>
        {deal.clientId ? <Link to={`/clients/${deal.clientId}`}>{deal.name}</Link> : deal.name}
        {deal.amountCents !== null && ` · ${formatMoney(deal.amountCents, deal.currency ?? 'EUR', locale)}`}
        {deal.quoteId && (
          <>
            {' · '}
            <Link to={`/documents/${deal.quoteId}`}>{deal.quoteNumber ?? t('pipeline.quote')}</Link>
          </>
        )}
      </p>
      {deal.nextActionOn && (
        <p className={deal.late ? `${styles.meta} ${styles.late}` : styles.meta}>
          {t(deal.late ? 'pipeline.late' : 'pipeline.next', { date: formatDate(deal.nextActionOn, locale) })}
          {deal.nextAction && ` · ${deal.nextAction}`}
        </p>
      )}
      <SelectField
        label={t('pipeline.changeStage')}
        value={deal.stage}
        disabled={action.busy}
        onChange={(event) =>
          void save(`/api/deals/${deal.id}`, 'PUT', {
            ...inputOf(deal),
            stage: event.target.value as DealStage,
          })
        }
      >
        {DEAL_STAGES.map((stage) => (
          <option key={stage} value={stage}>
            {t(`pipeline.stage.${stage}`)}
          </option>
        ))}
      </SelectField>
      <div className={styles.actions}>
        {(deal.stage === 'quote_sent' || deal.stage === 'follow_up' || deal.stage === 'lead') && (
          <Button variant="subtle" aria-expanded={followUp} onClick={() => setFollowUp(!followUp)}>
            {t('pipeline.followUpDone')}
          </Button>
        )}
        {!deal.clientId && deal.prospectName && (
          <Button
            variant="subtle"
            onClick={() =>
              void save(`/api/deals/${deal.id}/convert-client`, 'POST', {
                kind: 'company',
                name: deal.prospectName,
                email: null,
                country: profile?.country ?? 'FR',
                currency: deal.currency ?? profile?.currency ?? 'EUR',
                language: locale,
                paymentTermsDays: 30,
                contacts: [],
                notes: deal.prospectContact,
              })
            }
          >
            {t('pipeline.convert')}
          </Button>
        )}
        {deal.stage === 'won' && !deal.missionId && deal.clientId && (
          <Link to={`/missions/new?client=${deal.clientId}`}>{t('pipeline.createMission')}</Link>
        )}
        <Button variant="subtle" onClick={() => void save(`/api/deals/${deal.id}`, 'DELETE')}>
          {t('common.delete')}
        </Button>
      </div>
      {followUp && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save(`/api/deals/${deal.id}/follow-up`, 'POST', {
              note: values.note,
              nextActionOn: values.nextActionOn || null,
            }).then((ok) => ok && setFollowUp(false));
          }}
          noValidate
        >
          <TextField
            label={`${t('pipeline.note')} ${t('common.optional')}`}
            maxLength={2000}
            value={values.note}
            onChange={(event) => setValues({ ...values, note: event.target.value })}
          />
          <TextField
            label={`${t('pipeline.nextActionOn')} ${t('common.optional')}`}
            type="date"
            value={values.nextActionOn}
            onChange={(event) => setValues({ ...values, nextActionOn: event.target.value })}
          />
          <ActionBar primaryLabel={t('common.save')} busy={action.busy} feedback={action.feedback} />
        </form>
      )}
      {!followUp && action.feedback?.tone === 'error' && (
        <p className={styles.meta}>{action.feedback.text}</p>
      )}
    </article>
  );
}

/**
 * Form adding a deal: a client or a prospect, a title, an amount and the next action date
 *
 * @param props {{ clients: Client[]; currency: string; onSaved: () => void }} - clients, main currency, callback
 * @returns {JSX.Element} - the form
 */
function DealForm({
  clients,
  currency,
  onSaved,
}: {
  clients: Client[];
  currency: string;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const blank = { title: '', clientId: '', prospectName: '', amount: '', nextActionOn: '', nextAction: '' };
  const [values, setValues] = useState(blank);
  const [invalid, setInvalid] = useState(false);
  const action = useAction();

  /**
   * Creates the deal
   *
   * @param event {SyntheticEvent} - submission
   * @returns {Promise<void>} - resolves when done
   */
  async function submit(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    const amountCents = values.amount.trim() ? parseAmount(values.amount) : null;
    if ((values.amount.trim() && amountCents === null) || (!values.clientId && !values.prospectName.trim())) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const ok = await action.run(async () => {
      await api('/api/deals', {
        method: 'POST',
        body: {
          title: values.title,
          clientId: values.clientId || null,
          prospectName: values.clientId ? null : values.prospectName,
          amountCents,
          currency: amountCents === null ? null : currency,
          nextActionOn: values.nextActionOn || null,
          nextAction: values.nextAction || null,
        },
      });
      onSaved();
    });
    if (ok) setValues(blank);
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <SettingsSection
        title={t('pipeline.add')}
        footer={<ActionBar primaryLabel={t('pipeline.save')} busy={action.busy} feedback={action.feedback} />}
      >
        <div className={form.grid}>
          <TextField
            label={t('pipeline.dealTitle')}
            required
            maxLength={200}
            value={values.title}
            onChange={(event) => setValues({ ...values, title: event.target.value })}
          />
          <SelectField
            label={t('pipeline.client')}
            value={values.clientId}
            onChange={(event) => setValues({ ...values, clientId: event.target.value })}
          >
            <option value="">{t('pipeline.client.prospect')}</option>
            {clients
              .filter((client) => !client.archived)
              .map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
          </SelectField>
          {!values.clientId && (
            <TextField
              label={t('pipeline.prospectName')}
              required
              maxLength={160}
              value={values.prospectName}
              error={invalid && !values.prospectName.trim() ? t('pipeline.prospectName.required') : undefined}
              onChange={(event) => setValues({ ...values, prospectName: event.target.value })}
            />
          )}
          <TextField
            label={`${t('pipeline.amount')} ${t('common.optional')}`}
            inputMode="decimal"
            value={values.amount}
            error={
              invalid && values.amount.trim() && parseAmount(values.amount) === null
                ? t('errors.amount')
                : undefined
            }
            onChange={(event) => setValues({ ...values, amount: event.target.value })}
          />
          <TextField
            label={`${t('pipeline.nextActionOn')} ${t('common.optional')}`}
            type="date"
            value={values.nextActionOn}
            onChange={(event) => setValues({ ...values, nextActionOn: event.target.value })}
          />
          <TextField
            label={`${t('pipeline.nextAction')} ${t('common.optional')}`}
            maxLength={300}
            value={values.nextAction}
            onChange={(event) => setValues({ ...values, nextAction: event.target.value })}
          />
        </div>
      </SettingsSection>
    </form>
  );
}

/**
 * Days between a quote sent and its follow-up
 *
 * @param props {{ days: number; onSaved: () => void }} - current value and refresh callback
 * @returns {JSX.Element} - the form
 */
function FollowUpDaysForm({ days, onSaved }: { days: number; onSaved: () => void }) {
  const { t } = useI18n();
  const [value, setValue] = useState(String(days));
  const action = useAction();
  const number = Number(value);
  const valid = Number.isInteger(number) && number >= 1 && number <= 90;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        void action.run(async () => {
          await api('/api/deals/settings', { method: 'PUT', body: { followUpDays: number } });
          onSaved();
        });
      }}
      noValidate
    >
      <SettingsSection
        title={t('pipeline.settings')}
        footer={
          <ActionBar
            primaryLabel={t('common.save')}
            busy={action.busy}
            dirty={value !== String(days)}
            feedback={action.feedback}
          />
        }
      >
        <TextField
          label={t('pipeline.followUpDays')}
          hint={t('pipeline.followUpDays.hint')}
          inputMode="numeric"
          value={value}
          error={valid ? undefined : t('pipeline.followUpDays.invalid')}
          onChange={(event) => setValue(event.target.value)}
        />
      </SettingsSection>
    </form>
  );
}
