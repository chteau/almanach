import { CLIENT_CSV_FIELDS, type ClientCsvField, CSV_MAX_ROWS, guessField, parseCsv } from '@almanach/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, buttonClassName } from '../../components/Button/Button.tsx';
import { ButtonLink } from '../../components/Button/ButtonLink.tsx';
import form from '../../components/FormPage/FormPage.module.css';
import { Notice } from '../../components/Notice/Notice.tsx';
import { PageHeader } from '../../components/PageHeader/PageHeader.tsx';
import { SelectField } from '../../components/SelectField/SelectField.tsx';
import { TableScroll } from '../../components/TableScroll/TableScroll.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { api } from '../../lib/api.ts';
import styles from '../../styles/text.module.css';
import { describeError } from '../install/errors.ts';

interface Report {
  accepted: number;
  rejected: { line: number; name: string; issues: { field: string; message: string }[] }[];
  imported: boolean;
}

/**
 * Imports clients from a CSV file: column mapping, preview, check, then import with a report of the
 * rejected lines (S-091, S-092, S-247)
 *
 * @returns {JSX.Element} - the page
 */
export function ClientImportPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [fileName, setFileName] = useState<string>();
  const [header, setHeader] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<(ClientCsvField | '')[]>([]);
  const [report, setReport] = useState<Report>();
  const [failure, setFailure] = useState<string>();
  const [busy, setBusy] = useState(false);

  /**
   * Reads the chosen file and guesses the column mapping
   *
   * @param file {File} - CSV file
   * @returns {Promise<void>} - resolves when read
   */
  async function load(file: File): Promise<void> {
    setReport(undefined);
    setFailure(undefined);
    const parsed = parseCsv(await file.text());
    const [first = [], ...rest] = parsed;
    if (rest.length === 0) {
      setFailure(t('import.empty'));
      return;
    }
    if (rest.length > CSV_MAX_ROWS) {
      setFailure(t('import.tooMany', { max: CSV_MAX_ROWS }));
      return;
    }
    const used = new Set<ClientCsvField>();
    setMapping(
      first.map((title) => {
        const field = guessField(title);
        if (!field || used.has(field)) return '';
        used.add(field);
        return field;
      }),
    );
    setFileName(file.name);
    setHeader(first);
    setRows(rest);
  }

  /**
   * Sends the mapped rows, as a check or for real
   *
   * @param dryRun {boolean} - true to only check
   * @returns {Promise<void>} - resolves with the report
   */
  async function send(dryRun: boolean): Promise<void> {
    setBusy(true);
    try {
      const body = rows.map((cells) => {
        const row: Partial<Record<ClientCsvField, string>> = {};
        mapping.forEach((field, index) => {
          if (field) row[field] = cells[index] ?? '';
        });
        return row;
      });
      const result = await api<Report>('/api/clients/import', {
        method: 'POST',
        body: { rows: body, dryRun },
      });
      setReport(result);
      setFailure(undefined);
      if (!dryRun && result.rejected.length === 0) navigate('/clients');
    } catch (problem) {
      setFailure(describeError(problem, t));
    } finally {
      setBusy(false);
    }
  }

  const hasName = mapping.includes('name');

  return (
    <>
      <PageHeader title={t('import.title')} subtitle={fileName} />
      <div className={form.form}>
        {failure && (
          <Notice tone="error" live>
            {failure}
          </Notice>
        )}
        <section className={form.section} aria-labelledby="import-file-title">
          <h2 id="import-file-title" className={styles.sectionTitle}>
            {t('import.file')}
          </h2>
          <p className={styles.text}>{t('import.body')}</p>
          <div className={form.actions}>
            <label className={`${buttonClassName('primary')} ${styles.fileButton}`}>
              {fileName ? t('import.otherFile') : t('import.choose')}
              <input
                type="file"
                accept=".csv,text/csv,text/plain"
                className="visually-hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void load(file);
                }}
              />
            </label>
          </div>
        </section>

        {header.length > 0 && (
          <section className={form.section} aria-labelledby="import-map-title">
            <h2 id="import-map-title" className={styles.sectionTitle}>
              {t('import.mapping')}
            </h2>
            <p className={styles.caption}>{t('import.mapping.hint', { count: rows.length })}</p>
            <div className={form.grid}>
              {header.map((title, index) => (
                <SelectField
                  // biome-ignore lint/suspicious/noArrayIndexKey: columns keep their position
                  key={index}
                  label={title || t('import.column', { index: index + 1 })}
                  value={mapping[index] ?? ''}
                  onChange={(event) => {
                    const next = [...mapping];
                    next[index] = event.target.value as ClientCsvField | '';
                    setMapping(next);
                    setReport(undefined);
                  }}
                >
                  <option value="">{t('import.ignore')}</option>
                  {CLIENT_CSV_FIELDS.map((field) => (
                    <option
                      key={field}
                      value={field}
                      disabled={mapping.includes(field) && mapping[index] !== field}
                    >
                      {t(`import.field.${field}`)}
                    </option>
                  ))}
                </SelectField>
              ))}
            </div>
            {!hasName && <Notice tone="warn">{t('import.needName')}</Notice>}
            <h3 className={styles.subTitle}>{t('import.preview')}</h3>
            <TableScroll>
              <table className={styles.table}>
                <caption className="visually-hidden">{t('import.preview')}</caption>
                <thead>
                  <tr>
                    {mapping.map((field, index) =>
                      field ? (
                        <th key={field} scope="col">
                          {t(`import.field.${field}`)}
                        </th>
                      ) : (
                        // biome-ignore lint/suspicious/noArrayIndexKey: ignored columns have no name
                        <th key={`ignored-${index}`} scope="col" className="visually-hidden">
                          {t('import.ignore')}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 5).map((cells, row) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: preview rows are static
                    <tr key={row}>
                      {mapping.map((field, index) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: columns keep their position
                        <td key={index} className={field ? undefined : styles.muted}>
                          {field ? cells[index] : ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <div className={form.actions}>
              <ButtonLink to="/clients" variant="ghost">
                {t('common.cancel')}
              </ButtonLink>
              <Button variant="ghost" disabled={!hasName || busy} onClick={() => void send(true)}>
                {t('import.check')}
              </Button>
              <Button disabled={!hasName || busy || report?.accepted === 0} onClick={() => void send(false)}>
                {report ? t('import.run', { count: report.accepted }) : t('import.runAll')}
              </Button>
            </div>
          </section>
        )}

        {report && (
          <section className={form.section} aria-labelledby="import-report-title" aria-live="polite">
            <h2 id="import-report-title" className={styles.sectionTitle}>
              {t('import.report')}
            </h2>
            <p className={styles.text}>
              {report.imported
                ? t('import.done', { count: report.accepted })
                : t('import.ready', { count: report.accepted })}
            </p>
            {report.rejected.length > 0 && (
              <>
                <p className={styles.text}>{t('import.rejected', { count: report.rejected.length })}</p>
                <ul className={styles.plain}>
                  {report.rejected.map((line) => (
                    <li key={line.line}>
                      {t('import.line', { line: line.line })}
                      {line.name ? ` (${line.name})` : ''} :{' '}
                      {line.issues
                        .map((issue) =>
                          issue.message === 'duplicate'
                            ? t('import.issue.duplicate')
                            : t('import.issue', {
                                field: (CLIENT_CSV_FIELDS as readonly string[]).includes(issue.field)
                                  ? t(`import.field.${issue.field as ClientCsvField}`)
                                  : issue.field,
                              }),
                        )
                        .join(' ; ')}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {report.imported && (
              <ButtonLink to="/clients" variant="primary">
                {t('import.toClients')}
              </ButtonLink>
            )}
          </section>
        )}
      </div>
    </>
  );
}
