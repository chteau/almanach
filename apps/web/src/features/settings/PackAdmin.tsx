import type { Localized, PackMeta } from '@almanach/shared';
import { useState } from 'react';
import { Badge } from '../../components/Badge/Badge.tsx';
import buttonStyles from '../../components/Button/Button.module.css';
import { Button } from '../../components/Button/Button.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Notice } from '../../components/Notice/Notice.tsx';
import list from '../../components/RowList/RowList.module.css';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { ApiError, api } from '../../lib/api.ts';
import { formatDate } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import styles from '../planning/Planning.module.css';

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
    installedAt: string;
    appliedAt: string | null;
    notes: string | null;
    years: number[];
  }[];
}

/**
 * Administrator section: installed country packs, signed updates, import and rollback (S-300 to S-304)
 *
 * @returns {JSX.Element} - the section
 */
export function PackAdmin() {
  const { t, locale } = useI18n();
  const { data, error, reload } = useResource<PackAdminData>('/api/admin/packs');
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string }>();
  const [later, setLater] = useState<Set<string>>(new Set());

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
    try {
      setMessage({ tone: 'info', text: await action() });
      reload();
    } catch (problem) {
      const code = problem instanceof ApiError ? String(problem.body.error ?? '') : '';
      setMessage({ tone: 'error', text: t(`packs.error.${code}` as 'packs.error.invalid_bundle') });
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

  return (
    <section className={form.section} aria-labelledby="packs-title">
      <h2 id="packs-title" className={styles.sectionTitle}>
        {t('packs.title')}
      </h2>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <ul className={list.list}>
        {data.packs.map((pack) => (
          <li key={pack.country} className={list.item}>
            <div className={list.row}>
              <span className={list.primary}>
                <strong>{pack.name[locale]}</strong>
                <span className={list.secondary}>
                  {pack.activeSequence === null
                    ? t('packs.builtin')
                    : t('packs.update', { sequence: pack.activeSequence })}{' '}
                  · {pack.years.join(', ') || '—'}
                </span>
              </span>
              <Badge tone={pack.maturity === 'verified' ? 'ok' : 'warn'}>
                {t(`settings.maturity.${pack.maturity}`)}
              </Badge>
              {pack.activeSequence !== null && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    void run(async () => {
                      await api(`/api/admin/packs/${pack.country}/builtin`, { method: 'POST' });
                      return t('packs.reverted', { country: pack.country });
                    })
                  }
                >
                  {t('packs.revert')}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {data.bundles
        .filter((bundle) => bundle.pending && !later.has(bundle.id))
        .map((bundle) => (
          <section key={bundle.id} className={styles.pendingUpdate} aria-labelledby={`pending-${bundle.id}`}>
            <h3 id={`pending-${bundle.id}`} className={styles.cardTitle}>
              {t('packs.pending', { country: bundle.country, sequence: bundle.sequence })}
            </h3>
            {bundle.notes && <p className={styles.caption}>{bundle.notes}</p>}
            {bundle.changes === null ? (
              <Notice tone="error">{t('packs.pending.invalid')}</Notice>
            ) : bundle.changes.length === 0 ? (
              <p className={styles.text}>{t('packs.change.none')}</p>
            ) : (
              <ul className={styles.plain}>
                {bundle.changes.map((change, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the list is fixed for a given bundle
                  <li key={index}>{describe(change)}</li>
                ))}
              </ul>
            )}
            <div className={form.actions}>
              <Button variant="ghost" onClick={() => setLater(new Set([...later, bundle.id]))}>
                {t('packs.later')}
              </Button>
              {bundle.changes !== null && (
                <Button
                  onClick={() =>
                    void run(async () => {
                      await api(`/api/admin/packs/bundles/${bundle.id}/activate`, { method: 'POST' });
                      return t('packs.applied', { country: bundle.country, sequence: bundle.sequence });
                    })
                  }
                >
                  {t('packs.apply')}
                </Button>
              )}
            </div>
          </section>
        ))}
      {data.bundles.some((bundle) => !bundle.pending) && (
        <>
          <h3 className={styles.cardTitle}>{t('packs.history')}</h3>
          <ul className={list.list}>
            {data.bundles
              .filter((bundle) => !bundle.pending)
              .map((bundle) => (
                <li key={bundle.id} className={list.item}>
                  <div className={list.row}>
                    <span className={list.primary}>
                      <strong>
                        {bundle.country} #{bundle.sequence}
                      </strong>
                      <span className={list.secondary}>
                        {formatDate((bundle.appliedAt ?? bundle.installedAt).slice(0, 10), locale)} ·{' '}
                        {t('packs.key', { key: bundle.keyId })}
                        {bundle.notes ? ` · ${bundle.notes}` : ''}
                      </span>
                    </span>
                    {bundle.active ? (
                      <Badge tone="ok">{t('packs.active')}</Badge>
                    ) : (
                      <Button
                        variant="ghost"
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
                    )}
                  </div>
                </li>
              ))}
          </ul>
        </>
      )}
      {data.enabled && data.automatic && (
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={data.autoCheck}
            onChange={(event) => {
              const enabled = event.target.checked;
              void run(async () => {
                await api('/api/admin/packs/auto-check', { method: 'PUT', body: { enabled } });
                return enabled ? t('packs.auto.on') : t('packs.auto.off');
              });
            }}
          />
          {t('packs.auto')}
        </label>
      )}
      {data.enabled && !data.automatic && <p className={styles.caption}>{t('packs.auto.noUrl')}</p>}
      {data.enabled ? (
        <div className={form.actions}>
          {data.automatic && (
            <Button
              variant="ghost"
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
          <label className={`${buttonStyles.button} ${buttonStyles.primary} ${styles.fileButton}`}>
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
      ) : (
        <p className={styles.caption}>{t('packs.disabled')}</p>
      )}
    </section>
  );
}
