import type { Localized, PackMeta } from '@almanach/shared';
import { useState } from 'react';
import { ActionBar } from '../../components/ActionBar/ActionBar.tsx';
import { Badge } from '../../components/Badge/Badge.tsx';
import { Button, buttonClassName } from '../../components/Button/Button.tsx';
import { ConfirmDialog } from '../../components/ConfirmDialog/ConfirmDialog.tsx';
import { Field } from '../../components/Field/Field.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import { Row } from '../../components/Row/Row.tsx';
import list from '../../components/RowList/RowList.module.css';
import { SettingsSection } from '../../components/SettingsSection/SettingsSection.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { ApiError, api } from '../../lib/api.ts';
import { formatDate } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import text from '../../styles/text.module.css';
import { describeError } from '../install/errors.ts';

/** One difference listed under a pending update, as computed by the server. */
type RuleChange =
  | { type: 'year_added' | 'year_removed' | 'holidays' | 'wording'; year: number }
  | {
      type: 'threshold';
      year: number;
      label: Localized;
      field: 'limit' | 'tolerance';
      from: number | null;
      to: number | null;
    }
  | { type: 'rate'; year: number; label: Localized; from: number | null; to: number; effective: string }
  | { type: 'formula' | 'deadline' | 'added' | 'removed'; year: number; label: Localized };

interface PackAdminData {
  enabled: boolean;
  automatic: boolean;
  autoCheck: boolean;
  packs: {
    country: string;
    name: Localized;
    maturity: PackMeta['maturity'];
    years: number[];
    activeSequence: number | null;
  }[];
  bundles: {
    id: string;
    country: string;
    sequence: number;
    keyId: string;
    active: boolean;
    pending: boolean;
    changes: RuleChange[] | null;
    /** Why the bundle cannot be applied here, e.g. "app_too_old" with the version it needs. */
    refused: string | null;
    refusedMinAppVersion: string | null;
    installedAt: string;
    appliedAt: string | null;
    notes: string | null;
    years: number[];
  }[];
}

/**
 * Administrator panel: installed country packs, signed updates, import and rollback (S-300 to S-304)
 *
 * @returns {JSX.Element} - the section
 */
export function PackAdmin() {
  const { t, locale } = useI18n();
  const { data, error, reload } = useResource<PackAdminData>('/api/admin/packs');
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string }>();
  const [later, setLater] = useState<Set<string>>(new Set());
  const [reverting, setReverting] = useState<string>();
  const [busy, setBusy] = useState(false);

  /**
   * Puts one difference into words (S-244b)
   *
   * @param change {RuleChange} - difference computed by the server
   * @returns {string} - sentence
   */
  const describe = (change: RuleChange): string => {
    const amount = (cents: number | null) =>
      cents === null ? '—' : (cents / 100).toLocaleString(locale, { maximumFractionDigits: 2 });
    const rate = (bp: number | null) => (bp === null ? '—' : `${(bp / 100).toLocaleString(locale)} %`);
    switch (change.type) {
      case 'threshold':
        return t(`packs.change.${change.field}`, {
          label: change.label[locale],
          year: change.year,
          from: amount(change.from),
          to: amount(change.to),
        });
      case 'rate':
        return t('packs.change.rate', {
          label: change.label[locale],
          year: change.year,
          from: rate(change.from),
          to: rate(change.to),
          date: formatDate(change.effective, locale),
        });
      case 'formula':
      case 'deadline':
      case 'added':
      case 'removed':
        return t(`packs.change.${change.type}`, { label: change.label[locale], year: change.year });
      default:
        return t(`packs.change.${change.type}`, { year: change.year });
    }
  };

  /**
   * Runs an administrative call and reports its outcome
   *
   * @param action {() => Promise<string>} - call returning the success message
   * @returns {Promise<void>} - resolves when done
   */
  const run = async (action: () => Promise<string>): Promise<void> => {
    setBusy(true);
    try {
      setMessage({ tone: 'success', text: await action() });
      reload();
    } catch (problem) {
      const code = problem instanceof ApiError ? String(problem.body.error ?? '') : '';
      setMessage({
        tone: 'error',
        text: code ? t(`packs.error.${code}` as 'packs.error.invalid_bundle') : describeError(problem, t),
      });
    } finally {
      setBusy(false);
    }
  };

  /**
   * Reads and imports a bundle file chosen by the administrator
   *
   * @param file {File} - bundle JSON
   * @returns {Promise<void>} - resolves when done
   */
  const importFile = (file: File): Promise<void> =>
    run(async () => {
      let body: unknown;
      try {
        body = JSON.parse(await file.text());
      } catch {
        throw new ApiError(422, { error: 'invalid_bundle' });
      }
      const result = await api<{ country: string; sequence: number }>('/api/admin/packs/import', {
        method: 'POST',
        body,
      });
      return t('packs.received', { country: result.country, sequence: result.sequence });
    });

  if (error !== undefined) return <LoadError error={error} onRetry={reload} />;
  if (!data) return <Skeleton rows={2} />;
  const history = data.bundles.filter((bundle) => !bundle.pending);
  const keys = [...new Set(history.map((bundle) => bundle.keyId))];

  return (
    <>
      {message && (
        <Notice tone={message.tone} live>
          {message.text}
        </Notice>
      )}
      <SettingsSection title={t('packs.title')} description={t('settings.packs.body')}>
        <ul className={list.list}>
          {data.packs.map((pack) => (
            <li key={pack.country} className={list.item}>
              <Row
                primary={
                  <>
                    <strong>{pack.name[locale]}</strong>{' '}
                    <Badge tone={pack.maturity === 'verified' ? 'ok' : 'warn'}>
                      {t(`settings.maturity.${pack.maturity}`)}
                    </Badge>
                  </>
                }
                meta={`${
                  pack.activeSequence === null
                    ? t('packs.builtin')
                    : t('packs.update', { sequence: pack.activeSequence })
                } · ${pack.years.join(', ') || '—'}`}
                actions={
                  pack.activeSequence !== null && (
                    <Button variant="ghost" aria-haspopup="dialog" onClick={() => setReverting(pack.country)}>
                      {t('packs.revert')}
                    </Button>
                  )
                }
              />
            </li>
          ))}
        </ul>
      </SettingsSection>
      {data.bundles
        .filter((bundle) => bundle.pending && !later.has(bundle.id))
        .map((bundle) => (
          <SettingsSection
            key={bundle.id}
            title={t('packs.pending', { country: bundle.country, sequence: bundle.sequence })}
            description={bundle.notes ?? undefined}
            badge={<Badge tone="accent">{t('settings.packs.new')}</Badge>}
            footer={
              <ActionBar
                primaryLabel={t('packs.apply')}
                disabled={bundle.changes === null}
                busy={busy}
                onPrimary={() =>
                  void run(async () => {
                    await api(`/api/admin/packs/bundles/${bundle.id}/activate`, { method: 'POST' });
                    return t('packs.applied', { country: bundle.country, sequence: bundle.sequence });
                  })
                }
              >
                <Button variant="ghost" onClick={() => setLater(new Set([...later, bundle.id]))}>
                  {t('packs.later')}
                </Button>
              </ActionBar>
            }
          >
            {bundle.refused === 'app_too_old' ? (
              <Notice tone="error">
                {t('packs.pending.tooOld', { version: bundle.refusedMinAppVersion ?? '?' })}
              </Notice>
            ) : bundle.changes === null ? (
              <Notice tone="error">
                {t('packs.pending.invalid')}
                {bundle.refused && ` (${t('packs.pending.reason', { reason: bundle.refused })})`}
              </Notice>
            ) : bundle.changes.length === 0 ? (
              <p className={text.text}>{t('packs.change.none')}</p>
            ) : (
              <ul className={text.plain}>
                {bundle.changes.map((change, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the list is fixed for a given bundle
                  <li key={index}>{describe(change)}</li>
                ))}
              </ul>
            )}
          </SettingsSection>
        ))}
      <SettingsSection
        title={t('settings.packs.updates')}
        description={data.enabled ? undefined : t('packs.disabled')}
        footer={
          data.enabled && (
            <div className={form.actions}>
              {data.automatic && (
                <Button
                  variant="ghost"
                  busy={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await api<{ installed: unknown[] }>('/api/admin/packs/check', {
                        method: 'POST',
                      });
                      return t('packs.found', { count: result.installed.length });
                    })
                  }
                >
                  {t('packs.check')}
                </Button>
              )}
              <label className={`${buttonClassName('primary')} ${text.fileButton}`}>
                {t('packs.import')}
                <input
                  type="file"
                  accept="application/json,.json"
                  className="visually-hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void importFile(file);
                  }}
                />
              </label>
            </div>
          )
        }
      >
        {data.enabled && data.automatic && (
          <Field label={t('packs.auto')} checkbox>
            {(control) => (
              <input
                {...control}
                type="checkbox"
                checked={data.autoCheck}
                disabled={busy}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  void run(async () => {
                    await api('/api/admin/packs/auto-check', { method: 'PUT', body: { enabled } });
                    return enabled ? t('packs.auto.on') : t('packs.auto.off');
                  });
                }}
              />
            )}
          </Field>
        )}
        {data.enabled && !data.automatic && <p className={text.caption}>{t('packs.auto.noUrl')}</p>}
        {history.length > 0 && (
          <>
            <h3 className={text.subTitle}>{t('packs.history')}</h3>
            <ul className={list.list}>
              {history.map((bundle) => (
                <li key={bundle.id} className={list.item}>
                  <Row
                    primary={
                      <strong>
                        {bundle.country} · {t('packs.update', { sequence: bundle.sequence })}
                      </strong>
                    }
                    meta={`${formatDate((bundle.appliedAt ?? bundle.installedAt).slice(0, 10), locale)}${
                      bundle.notes ? ` · ${bundle.notes}` : ''
                    }`}
                    actions={
                      bundle.active ? (
                        <Badge tone="ok">{t('packs.active')}</Badge>
                      ) : (
                        <Button
                          variant="ghost"
                          busy={busy}
                          onClick={() =>
                            void run(async () => {
                              await api(`/api/admin/packs/bundles/${bundle.id}/activate`, { method: 'POST' });
                              return t('packs.activated', {
                                country: bundle.country,
                                sequence: bundle.sequence,
                              });
                            })
                          }
                        >
                          {t('packs.activate')}
                        </Button>
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          </>
        )}
        <details className={text.details}>
          <summary>{t('settings.technical')}</summary>
          <p>{t('settings.packs.technical')}</p>
          {keys.length > 0 && (
            <p className={text.mono}>{keys.map((key) => t('packs.key', { key })).join(' · ')}</p>
          )}
        </details>
      </SettingsSection>
      <ConfirmDialog
        open={reverting !== undefined}
        title={t('packs.revert')}
        body={t('settings.packs.revert.body')}
        confirmLabel={t('packs.revert')}
        onCancel={() => setReverting(undefined)}
        onConfirm={() => {
          const country = reverting;
          setReverting(undefined);
          void run(async () => {
            await api(`/api/admin/packs/${country}/builtin`, { method: 'POST' });
            return t('packs.reverted', { country: country ?? '' });
          });
        }}
      />
    </>
  );
}
