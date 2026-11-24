import type {
  ActivityBreakdown,
  DeadlineOccurrence,
  EstimateResult,
  Localized,
  PackFeatures,
  PackMaturity,
  ThresholdProgress,
} from '@almanach/shared';

/** Calendar entry as returned by GET /api/calendar. */
export interface CalendarItem {
  key: string;
  type: 'tax' | 'social' | 'mission' | 'invoice' | 'custom';
  title: Localized | string;
  date: string;
  movedFrom: string | null;
  link: string | null;
  done: boolean;
  hidden: boolean;
  overdue: boolean;
}

/** Yearly outlook as returned by GET /api/outlook. */
export interface Outlook {
  year: number;
  fiscalYear: { start: string; end: string };
  rulesYear: number;
  fallback: boolean;
  /** Maturity of the country and of each function; a function absent from `features` is unavailable. */
  pack: { country: string; maturity: PackMaturity; features: PackFeatures };
  currency: string;
  collectedCents: number;
  projectedRevenueCents: number;
  unconverted: number;
  thresholds: ThresholdProgress[];
  /** Revenue, estimates and allowance per activity, the main one first. */
  activities: ActivityBreakdown[];
  /**
   * Other activities of the same business, from linked instances: revenue of the fiscal year and the activity it
   * counts as ("main" or a status), null when it only counts in the thresholds.
   */
  linked: {
    label: string;
    cents: number;
    receivedAt: string | null;
    error: string | null;
    activity: string | null;
  }[];
  estimates: EstimateResult[];
  projection: EstimateResult[];
  months: { month: string; revenueCents: number; estimateCents: number }[];
}

/** Deadline detail as returned by GET /api/deadlines/:key. */
export interface DeadlineDetail {
  occurrence: DeadlineOccurrence;
  revenueCents: number | null;
  unconverted: number;
  estimates: EstimateResult[];
  /** Per activity, when the business has several. */
  activities: ActivityBreakdown[];
  currency: string;
  mark: { doneOn: string | null; note: string | null; actualCents: number | null; hidden: boolean } | null;
}

/**
 * Picks the text of a label in the interface language
 *
 * @param title {Localized | string} - localized label or plain text
 * @param locale {keyof Localized} - interface language
 * @returns {string} - text to show
 */
export function labelOf(title: Localized | string, locale: keyof Localized): string {
  return typeof title === 'string' ? title : title[locale];
}

/** Colour token and icon path for each calendar entry type (S-061). */
export const TYPE_STYLE: Record<
  CalendarItem['type'],
  { tone: 'accent' | 'warn' | 'ok' | 'neutral' | 'err'; icon: string }
> = {
  tax: { tone: 'accent', icon: 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h3' },
  social: { tone: 'warn', icon: 'M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 11c0 5.5-7 10-7 10' },
  mission: { tone: 'neutral', icon: 'M4 7h16v12H4zM9 7V4h6v3' },
  invoice: { tone: 'ok', icon: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6' },
  custom: { tone: 'neutral', icon: 'M12 3v18M3 12h18' },
};
