import { Link } from 'react-router';
import { Button } from '../../components/Button/Button.tsx';
import { EmptyState } from '../../components/EmptyState/EmptyState.tsx';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { PageHeader } from '../../components/PageHeader/PageHeader.tsx';
import list from '../../components/RowList/RowList.module.css';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { useI18n } from '../../i18n/I18nProvider.tsx';
import type { MessageKey } from '../../i18n/messages.ts';
import { api } from '../../lib/api.ts';
import { formatDate } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import styles from './Planning.module.css';

interface NotificationRow {
  id: string;
  kind: string;
  params: Record<string, string | number>;
  link: string | null;
  createdAt: string;
  read: boolean;
}

/**
 * In-app notification centre: reminders, late invoices and thresholds (P19, S-230)
 *
 * @returns {JSX.Element} - the page
 */
export function NotificationsPage() {
  const { t, locale } = useI18n();
  const { data, error, loading, reload } = useResource<{ notifications: NotificationRow[] }>(
    '/api/notifications',
  );
  const unread = data?.notifications.filter((item) => !item.read).length ?? 0;

  /**
   * Renders a notification in the interface language
   *
   * @param row {NotificationRow} - notification
   * @returns {string} - message
   */
  const text = (row: NotificationRow): string => {
    const key = (
      row.kind === 'deadline_soon' && row.params.days === 0
        ? 'notifications.deadline_today'
        : `notifications.${row.kind}`
    ) as MessageKey;
    const params = {
      ...row.params,
      date: typeof row.params.date === 'string' ? formatDate(row.params.date, locale) : '',
    };
    return t(key, params);
  };

  /**
   * Marks one notification read
   *
   * @param id {string} - notification id
   * @returns {Promise<void>} - resolves when saved
   */
  const markRead = async (id: string): Promise<void> => {
    await api(`/api/notifications/${id}/read`, { method: 'POST' }).catch(() => undefined);
    reload();
  };

  return (
    <>
      <PageHeader title={t('nav.notifications')}>
        {unread > 0 && (
          <Button
            variant="ghost"
            onClick={() => void api('/api/notifications/read-all', { method: 'POST' }).then(reload)}
          >
            {t('notifications.readAll')}
          </Button>
        )}
      </PageHeader>
      {error !== undefined && <LoadError error={error} onRetry={reload} />}
      {loading && !data && <Skeleton rows={4} />}
      {data?.notifications.length === 0 && (
        <EmptyState title={t('notifications.empty.title')} body={t('notifications.empty.body')} />
      )}
      {data && data.notifications.length > 0 && (
        <ul className={list.list}>
          {data.notifications.map((row) => (
            <li key={row.id} className={list.item}>
              <div className={`${list.row} ${row.read ? '' : styles.unread}`}>
                <span className={list.primary}>
                  {row.link ? (
                    <Link to={row.link} onClick={() => void markRead(row.id)}>
                      {row.read ? text(row) : <strong>{text(row)}</strong>}
                    </Link>
                  ) : (
                    text(row)
                  )}
                  <span className={list.secondary}>
                    {formatDate(row.createdAt.slice(0, 10), locale)}
                    {!row.read && ` · ${t('notifications.unread')}`}
                  </span>
                </span>
                {!row.read && (
                  <Button variant="ghost" onClick={() => void markRead(row.id)}>
                    {t('notifications.markRead')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.caption}>
        <Link to="/settings#reminders">{t('notifications.configure')}</Link>
      </p>
    </>
  );
}
