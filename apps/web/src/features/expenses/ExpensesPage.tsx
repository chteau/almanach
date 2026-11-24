import {
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
  type ExpenseView,
  type Localized,
  parseAmount,
} from '@almanach/shared';
import { type SyntheticEvent, useState } from 'react';
import { ActionBar } from '../../components/ActionBar/ActionBar.tsx';
import { Badge } from '../../components/Badge/Badge.tsx';
import { Button } from '../../components/Button/Button.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog.tsx';
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { PageHeader } from '../../components/PageHeader/PageHeader.tsx';
import { Row } from '../../components/Row/Row.tsx';
import list from '../../components/RowList/RowList.module.css';
import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { SettingsSection } from '../../components/SettingsSection/SettingsSection.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { TextField } from '../../components/TextField/TextField.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { api } from '../../lib/api.ts';
import { formatDate, formatMoney, today } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import { ActivitySelect } from '../activities/ActivitySelect.tsx';
import { useAction } from '../settings/useAction.ts';
import { VaultItemSelect } from '../vault/VaultItemSelect.tsx';

interface ExpenseList {
  expenses: ExpenseView[];
  currency: string | null;
  maturity: string | null;
  note: Localized | null;
}

/**
 * Simple expenses: amount, date, category, VAT, optional activity and receipt from the vault
 *
 * @returns {JSX.Element} - the page
 */
export function ExpensesPage() {
  const { t, locale } = useI18n();
  const { data, error, loading, reload } = useResource<ExpenseList>('/api/expenses');
  const [removing, setRemoving] = useState<ExpenseView | null>(null);
  const currency = data?.currency ?? 'EUR';
  const money = (cents: number) => formatMoney(cents, currency, locale);
  const total = (data?.expenses ?? []).reduce((sum, item) => sum + item.amountCents, 0);

  return (
    <>
      <PageHeader
        title={t('expenses.title')}
        subtitle={
          data && data.expenses.length > 0 ? t('expenses.total', { amount: money(total) }) : undefined
        }
      />
      {error !== undefined && <LoadError error={error} onRetry={reload} />}
      {loading && !data && <Skeleton rows={4} />}
      {data && (
        <div className={form.form}>
          {data.note && (
            <Notice tone="info">
              {data.note[locale]}{' '}
              {data.maturity !== 'verified' && <Badge tone="warn">{t('pack.maturity.experimental')}</Badge>}
            </Notice>
          )}
          <ExpenseForm currency={currency} onSaved={reload} />
          <SettingsSection title={t('expenses.list')}>
            {data.expenses.length === 0 ? (
              <EmptyState inline title={t('expenses.empty.title')} body={t('expenses.empty.body')} />
            ) : (
              <ul className={list.list}>
                {data.expenses.map((expense) => (
                  <li key={expense.id}>
                    <Row
                      primary={`${expense.description || t(`expenses.category.${expense.category}`)} · ${money(expense.amountCents)}`}
                      meta={[
                        formatDate(expense.date, locale),
                        t(`expenses.category.${expense.category}`),
                        expense.vatCents > 0 && t('expenses.vatOf', { amount: money(expense.vatCents) }),
                        expense.vaultItemId && t('expenses.withReceipt'),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      actions={
                        <Button variant="danger" onClick={() => setRemoving(expense)}>
                          {t('common.delete')}
                        </Button>
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </SettingsSection>
        </div>
      )}
      <ConfirmDialog
        open={removing !== null}
        title={t('expenses.delete')}
        body={t('expenses.delete.body')}
        confirmLabel={t('common.delete')}
        danger
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const target = removing;
          setRemoving(null);
          if (target) void api(`/api/expenses/${target.id}`, { method: 'DELETE' }).then(reload);
        }}
      />
    </>
  );
}

/**
 * Form to record an expense
 *
 * @param props {{ currency: string; onSaved: () => void }} - main currency and refresh callback
 * @returns {JSX.Element} - the form
 */
function ExpenseForm({ currency, onSaved }: { currency: string; onSaved: () => void }) {
  const { t } = useI18n();
  const blank = {
    date: today(),
    amount: '',
    vat: '',
    category: 'other' as ExpenseCategory,
    description: '',
    activityId: null as string | null,
    vaultItemId: null as string | null,
  };
  const [values, setValues] = useState(blank);
  const [invalid, setInvalid] = useState(false);
  const action = useAction();

  /**
   * Validates and records the expense
   *
   * @param event {SyntheticEvent} - submission
   * @returns {Promise<void>} - resolves when done
   */
  async function submit(event: SyntheticEvent): Promise<void> {
    event.preventDefault();
    const amountCents = parseAmount(values.amount);
    const vatCents = values.vat.trim() ? parseAmount(values.vat) : 0;
    if (amountCents === null || vatCents === null || amountCents < 0 || vatCents < 0) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const ok = await action.run(async () => {
      await api('/api/expenses', {
        method: 'POST',
        body: {
          date: values.date,
          amountCents,
          vatCents,
          category: values.category,
          description: values.description,
          activityId: values.activityId,
          vaultItemId: values.vaultItemId,
        },
      });
      onSaved();
    });
    if (ok) setValues(blank);
  }

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <SettingsSection
        title={t('expenses.add')}
        footer={<ActionBar primaryLabel={t('expenses.save')} busy={action.busy} feedback={action.feedback} />}
      >
        <div className={form.grid}>
          <TextField
            label={t('expenses.date')}
            type="date"
            required
            value={values.date}
            onChange={(event) => setValues({ ...values, date: event.target.value })}
          />
          <TextField
            label={t('expenses.amount', { currency })}
            inputMode="decimal"
            required
            value={values.amount}
            error={invalid ? t('errors.amount') : undefined}
            onChange={(event) => setValues({ ...values, amount: event.target.value })}
          />
          <TextField
            label={`${t('expenses.vat', { currency })} ${t('common.optional')}`}
            inputMode="decimal"
            value={values.vat}
            onChange={(event) => setValues({ ...values, vat: event.target.value })}
          />
          <SelectField
            label={t('expenses.category')}
            value={values.category}
            onChange={(event) => setValues({ ...values, category: event.target.value as ExpenseCategory })}
          >
            {EXPENSE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {t(`expenses.category.${category}`)}
              </option>
            ))}
          </SelectField>
          <TextField
            label={`${t('expenses.description')} ${t('common.optional')}`}
            maxLength={200}
            value={values.description}
            onChange={(event) => setValues({ ...values, description: event.target.value })}
          />
          <ActivitySelect
            value={values.activityId}
            onChange={(activityId) => setValues({ ...values, activityId })}
            inheritLabel={t('activities.inherit')}
          />
          <VaultItemSelect
            value={values.vaultItemId}
            onChange={(vaultItemId) => setValues({ ...values, vaultItemId })}
          />
        </div>
      </SettingsSection>
    </form>
  );
}
