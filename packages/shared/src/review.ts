import type { Localized } from './rules.ts';

/** One thing to do this week, self-contained for a person or an assistant. */
export interface ReviewAction {
  id: string;
  type:
    | 'declaration'
    | 'payment'
    | 'invoice_overdue'
    | 'quote_follow_up'
    | 'threshold'
    | 'deal_follow_up'
    | 'vault_expiring';
  due: string | null;
  title: Localized | string;
  /** Machine-readable reason, translated by the interface. */
  why: string;
  amountCents: number | null;
  currency: string | null;
  link: string;
  source: string | null;
}

/** A deadline of the review, with the amount prepared for it when there is one. */
export interface ReviewDeadline {
  key: string;
  type: string;
  title: Localized | string;
  date: string;
  link: string;
  preparedAmountCents: number | null;
}

/** Weekly review of one company (format `weeklyReview/1`); a section of a function not offered is absent. */
export interface WeeklyReview {
  format: 'weeklyReview/1';
  company: { id: string; name: string };
  week: { start: string; end: string; today: string; timezone: string };
  currency: string;
  actions: ReviewAction[];
  deadlines: { overdue: ReviewDeadline[]; next14Days: ReviewDeadline[] };
  cash: {
    collectedThisWeekCents: number;
    collectedLastWeekCents: number;
    invoicesOverdue: {
      id: string;
      number: string;
      clientName: string;
      dueDate: string | null;
      currency: string;
      dueCents: number;
    }[];
    invoicesDueThisWeek: {
      id: string;
      number: string;
      clientName: string;
      dueDate: string | null;
      currency: string;
      dueCents: number;
    }[];
  };
  quotes: {
    awaitingAnswer: {
      id: string;
      number: string | null;
      clientName: string;
      issueDate: string;
      ageDays: number;
      totalCents: number;
      currency: string;
    }[];
  };
  thresholds: { id: string; label: Localized; reachedBp: number; exceeded: boolean }[];
  reserve?: { reserveCents: number; deltaThisWeekCents: number; warning: Localized };
  deals?: {
    followUpsDue: {
      id: string;
      title: string;
      name: string;
      nextActionOn: string;
      nextAction: string | null;
    }[];
    followUpsLate: {
      id: string;
      title: string;
      name: string;
      nextActionOn: string;
      nextAction: string | null;
    }[];
  };
  vault?: {
    expiringWithin60Days: { id: string; title: string; kind: string; expiresOn: string }[];
    expired: { id: string; title: string; kind: string; expiresOn: string }[];
  };
  notices: ('pack_update_available' | 'unconverted_payments')[];
  testDataExcluded: true;
}
