import type { Client, DocumentType, DocumentView, Mission } from '@almanach/shared';
import { useParams, useSearchParams } from 'react-router';
import { LoadError } from '../../components/LoadError/LoadError.tsx';
import { Skeleton } from '../../components/Skeleton/Skeleton.tsx';
import { today } from '../../lib/format.ts';
import { useResource } from '../../lib/useResource.ts';
import { DocumentDetail } from './DocumentDetail.tsx';
import { DocumentEditor } from './DocumentEditor.tsx';

const TYPES: DocumentType[] = ['quote', 'invoice', 'deposit', 'credit_note'];

/**
 * Route /documents/new and /documents/:id: the editor for drafts, the read-only record otherwise
 *
 * @returns {JSX.Element} - the page
 */
export function DocumentPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const doc = useResource<{
    document: DocumentView;
    missing: string[];
    einvoice: { missing: string[] } | null;
  }>(id ? `/api/documents/${id}?today=${today()}` : null);
  const clients = useResource<{ clients: Client[] }>('/api/clients');
  const missions = useResource<{ missions: Mission[] }>('/api/missions');
  const deposits = useResource<{ documents: DocumentView[] }>('/api/documents?type=invoice');
  const billing = useResource<{ settings: { defaultNote: string | null; facturxDefault: boolean } }>(
    id ? null : '/api/billing',
  );

  const failed = doc.error ?? clients.error ?? missions.error ?? deposits.error;
  if (failed !== undefined) {
    return (
      <LoadError
        error={failed}
        onRetry={() => {
          doc.reload();
          clients.reload();
          missions.reload();
          deposits.reload();
        }}
      />
    );
  }
  if ((id && !doc.data) || !clients.data || !missions.data || !deposits.data) return <Skeleton rows={6} />;
  // The default note is optional: a failed load simply leaves the note empty.
  if (!id && !billing.data && billing.error === undefined) return <Skeleton rows={6} />;

  const current = doc.data?.document ?? null;
  if (current && current.state !== 'draft')
    return <DocumentDetail document={current} onChange={doc.reload} />;

  const requested = params.get('type') as DocumentType | null;
  return (
    <DocumentEditor
      key={current?.id ?? 'new'}
      initial={current}
      missing={doc.data?.missing ?? []}
      einvoiceMissing={doc.data?.einvoice?.missing ?? null}
      facturxDefault={billing.data?.settings.facturxDefault ?? false}
      type={current?.type ?? (requested && TYPES.includes(requested) ? requested : 'invoice')}
      clients={clients.data.clients}
      missions={missions.data.missions}
      deposits={deposits.data.documents.filter((candidate) => candidate.type === 'deposit')}
      presetClient={params.get('client')}
      presetMission={params.get('mission')}
      defaultNote={billing.data?.settings.defaultNote ?? ''}
      onIssued={doc.reload}
    />
  );
}
