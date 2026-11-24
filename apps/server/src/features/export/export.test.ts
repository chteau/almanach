import { describe, expect, test } from 'bun:test';
import { referenceProblem } from './export.ts';

const empty = {
  profiles: [],
  companyActivities: [],
  clients: [],
  missions: [],
  documents: [],
  numberSequences: [],
  payments: [],
  timeEntries: [],
  customDeadlines: [],
  deadlineMarks: [],
  billingSettings: [],
  situationChanges: [],
  externalRevenues: [],
  reserveSettings: [],
  deadlineNotices: [],
  vaultItems: [],
  expenses: [],
  deals: [],
  dealEvents: [],
  pipelineSettings: [],
};

describe('import references', () => {
  test('a consistent export passes', () => {
    expect(
      referenceProblem({
        ...empty,
        clients: [{ id: 'c1' }],
        missions: [{ id: 'm1', clientId: 'c1' }],
        documents: [
          { id: 'd1', clientId: 'c1', missionId: 'm1', relatedId: null, depositIds: [] },
          { id: 'd2', clientId: 'c1', missionId: null, relatedId: 'd1', depositIds: ['d1'] },
        ],
        payments: [{ id: 'p1', documentId: 'd1' }],
        timeEntries: [{ id: 't1', missionId: 'm1', documentId: 'd1' }],
      }),
    ).toBeNull();
  });

  test('references to rows outside the export are refused', () => {
    expect(referenceProblem({ ...empty, missions: [{ id: 'm1', clientId: 'someone-else' }] })).toBe(
      'missions.clientId',
    );
    expect(
      referenceProblem({
        ...empty,
        clients: [{ id: 'c1' }],
        documents: [{ id: 'd1', clientId: 'c1', missionId: null, relatedId: null, depositIds: ['other'] }],
      }),
    ).toBe('documents.depositIds');
    expect(referenceProblem({ ...empty, payments: [{ id: 'p1', documentId: 'other' }] })).toBe(
      'payments.documentId',
    );
    expect(
      referenceProblem({ ...empty, timeEntries: [{ id: 't1', missionId: 'other', documentId: null }] }),
    ).toBe('timeEntries.reference');
  });
});
