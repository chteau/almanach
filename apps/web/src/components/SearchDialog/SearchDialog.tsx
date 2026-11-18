import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import { api } from '../../lib/api.ts';
import { formatDate } from '../../lib/format.ts';
import styles from './SearchDialog.module.css';

interface Results {
  clients: { id: string; name: string }[];
  missions: { id: string; name: string; clientName: string }[];
  documents: { id: string; number: string | null; type: string; state: string; clientName: string }[];
  deadlines: { id: string; title: string; date: string }[];
}

const EMPTY: Results = { clients: [], missions: [], documents: [], deadlines: [] };

/**
 * Global search opened with Ctrl/Cmd + K, with quick actions (P21, S-260 to S-262)
 *
 * @param props {{ open: boolean; onClose: () => void }} - visibility and close callback
 * @returns {JSX.Element} - the dialog
 */
export function SearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, locale } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Results>(EMPTY);

  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog?.open) dialog?.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setResults(EMPTY);
      return;
    }
    const timer = setTimeout(() => {
      void api<Results>(`/api/search?q=${encodeURIComponent(text)}`)
        .then(setResults)
        .catch(() => setResults(EMPTY));
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  const count =
    results.clients.length + results.missions.length + results.documents.length + results.deadlines.length;

  /**
   * Closes the dialog and clears the search
   *
   * @returns {void} - nothing
   */
  const close = (): void => {
    setQuery('');
    onClose();
  };

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="search-title"
      onClose={close}
      onCancel={close}
    >
      <h2 id="search-title" className="visually-hidden">
        {t('search.title')}
      </h2>
      <label className={styles.field}>
        <span className="visually-hidden">{t('search.label')}</span>
        <input
          type="search"
          value={query}
          placeholder={t('search.placeholder')}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
          autoFocus
        />
      </label>
      <p className="visually-hidden" aria-live="polite">
        {query.trim().length >= 2 ? t('search.count', { count }) : ''}
      </p>
      <nav aria-label={t('search.results')} className={styles.results}>
        {results.documents.length > 0 && (
          <Group title={t('search.documents')}>
            {results.documents.map((doc) => (
              <Link key={doc.id} to={`/documents/${doc.id}`} onClick={close}>
                <strong>{doc.number ?? t('search.draft')}</strong> · {doc.clientName}
              </Link>
            ))}
          </Group>
        )}
        {results.clients.length > 0 && (
          <Group title={t('search.clients')}>
            {results.clients.map((client) => (
              <span key={client.id} className={styles.withAction}>
                <Link to={`/clients/${client.id}`} onClick={close}>
                  <strong>{client.name}</strong>
                </Link>
                <Link
                  to={`/documents/new?type=invoice&client=${client.id}`}
                  onClick={close}
                  className={styles.action}
                >
                  {t('search.newInvoice')}
                </Link>
              </span>
            ))}
          </Group>
        )}
        {results.missions.length > 0 && (
          <Group title={t('search.missions')}>
            {results.missions.map((mission) => (
              <Link key={mission.id} to={`/missions/${mission.id}`} onClick={close}>
                <strong>{mission.name}</strong> · {mission.clientName}
              </Link>
            ))}
          </Group>
        )}
        {results.deadlines.length > 0 && (
          <Group title={t('search.deadlines')}>
            {results.deadlines.map((deadline) => (
              <Link key={deadline.id} to={`/calendar/custom/${deadline.id}`} onClick={close}>
                <strong>{deadline.title}</strong> · {formatDate(deadline.date, locale)}
              </Link>
            ))}
          </Group>
        )}
        {query.trim().length >= 2 && count === 0 && <p className={styles.empty}>{t('search.none')}</p>}
      </nav>
      <p className={styles.hint}>{t('search.hint')}</p>
    </dialog>
  );
}

/**
 * Titled group of results
 *
 * @param props {{ title: string; children: React.ReactNode }} - heading and links
 * @returns {JSX.Element} - the group
 */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={styles.group}>
      <h3>{title}</h3>
      {children}
    </div>
  );
}
