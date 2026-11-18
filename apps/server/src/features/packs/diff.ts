import type { EstimateRule, Localized, ThresholdRule, YearRules } from '@almanach/shared';

/** One difference between the rules in use and an update, worded by the interface (S-244b). */
export type RuleChange =
  | { type: 'year_added' | 'year_removed' | 'holidays' | 'wording'; year: number }
  | {
      type: 'threshold';
      year: number;
      id: string;
      label: Localized;
      field: 'limit' | 'tolerance';
      from: number | null;
      to: number | null;
    }
  | {
      type: 'rate';
      year: number;
      id: string;
      label: Localized;
      from: number | null;
      to: number;
      effective: string;
    }
  | {
      type: 'formula' | 'deadline' | 'added' | 'removed';
      year: number;
      id: string;
      label: Localized;
    };

/**
 * Rate of a flat estimate in force on a date
 *
 * @param rule {EstimateRule | undefined} - estimate
 * @param date {string} - YYYY-MM-DD
 * @returns {number | null} - rate in basis points, null when none applies
 */
function rateOn(rule: EstimateRule | undefined, date: string): number | null {
  if (rule?.formula.kind !== 'flat') return null;
  const rates = [...rule.formula.rates].sort((a, b) => a.from.localeCompare(b.from));
  const found = rates.filter((rate) => rate.from <= date).at(-1) ?? rates[0];
  return found?.rateBp ?? null;
}

/**
 * Lists added, removed and changed rules of one kind, matched by id
 *
 * @param year {number} - fiscal year
 * @param before {T[]} - rules in use
 * @param after {T[]} - rules of the update
 * @param changed {(old: T, next: T) => RuleChange[]} - details of a rule present in both
 * @returns {RuleChange[]} - differences
 */
function byId<T extends { id: string; label: Localized }>(
  year: number,
  before: T[],
  after: T[],
  changed: (old: T, next: T) => RuleChange[],
): RuleChange[] {
  const changes: RuleChange[] = [];
  const old = new Map(before.map((rule) => [rule.id, rule]));
  for (const rule of after) {
    const previous = old.get(rule.id);
    if (!previous) changes.push({ type: 'added', year, id: rule.id, label: rule.label });
    else changes.push(...changed(previous, rule));
    old.delete(rule.id);
  }
  for (const rule of old.values()) changes.push({ type: 'removed', year, id: rule.id, label: rule.label });
  return changes;
}

/**
 * Compares two threshold rules
 *
 * @param year {number} - fiscal year
 * @param old {ThresholdRule} - rule in use
 * @param next {ThresholdRule} - rule of the update
 * @returns {RuleChange[]} - differences
 */
function thresholdChanges(year: number, old: ThresholdRule, next: ThresholdRule): RuleChange[] {
  const changes: RuleChange[] = [];
  const base = { type: 'threshold' as const, year, id: next.id, label: next.label };
  if (old.limitCents !== next.limitCents)
    changes.push({ ...base, field: 'limit', from: old.limitCents, to: next.limitCents });
  if ((old.toleranceCents ?? null) !== (next.toleranceCents ?? null))
    changes.push({
      ...base,
      field: 'tolerance',
      from: old.toleranceCents ?? null,
      to: next.toleranceCents ?? null,
    });
  return changes;
}

/**
 * Compares two estimates; flat rates are described rate by rate, other formulas as a whole
 *
 * @param year {number} - fiscal year
 * @param old {EstimateRule} - rule in use
 * @param next {EstimateRule} - rule of the update
 * @returns {RuleChange[]} - differences
 */
function estimateChanges(year: number, old: EstimateRule, next: EstimateRule): RuleChange[] {
  const changes: RuleChange[] = [];
  if (old.formula.kind === 'flat' && next.formula.kind === 'flat') {
    // Every date where either version starts a rate, so a rate dropped by the update shows too.
    const dates = [...new Set([...old.formula.rates, ...next.formula.rates].map((rate) => rate.from))].sort();
    for (const date of dates) {
      const before = rateOn(old, date);
      const after = rateOn(next, date);
      if (before !== after && after !== null)
        changes.push({
          type: 'rate',
          year,
          id: next.id,
          label: next.label,
          from: before,
          to: after,
          effective: date,
        });
    }
    if (JSON.stringify(old.formula.reduction) !== JSON.stringify(next.formula.reduction))
      changes.push({ type: 'formula', year, id: next.id, label: next.label });
  } else if (JSON.stringify(old.formula) !== JSON.stringify(next.formula)) {
    changes.push({ type: 'formula', year, id: next.id, label: next.label });
  }
  return changes;
}

/**
 * Summarizes what an update changes, so the person decides knowingly whether to apply it (S-244b)
 *
 * @param before {Map<number, YearRules>} - rules in use, per year
 * @param after {Map<number, YearRules>} - rules of the update, per year
 * @returns {RuleChange[]} - differences, by year
 */
export function diffRules(before: Map<number, YearRules>, after: Map<number, YearRules>): RuleChange[] {
  const changes: RuleChange[] = [];
  const years = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a - b);
  for (const year of years) {
    const old = before.get(year);
    const next = after.get(year);
    if (!old) {
      changes.push({ type: 'year_added', year });
      continue;
    }
    if (!next) {
      changes.push({ type: 'year_removed', year });
      continue;
    }
    const found = [
      ...byId(year, old.thresholds, next.thresholds, (a, b) => thresholdChanges(year, a, b)),
      ...byId(year, old.estimates, next.estimates, (a, b) => estimateChanges(year, a, b)),
      ...byId(year, old.deadlines, next.deadlines, (a, b) =>
        JSON.stringify(a.schedule) === JSON.stringify(b.schedule)
          ? []
          : [{ type: 'deadline', year, id: b.id, label: b.label }],
      ),
    ];
    if (JSON.stringify(old.holidays) !== JSON.stringify(next.holidays) || old.shift !== next.shift)
      found.push({ type: 'holidays', year });
    // Anything else (sources, wording, verification dates) is grouped in one line.
    if (found.length === 0 && JSON.stringify(old) !== JSON.stringify(next))
      found.push({ type: 'wording', year });
    changes.push(...found);
  }
  return changes;
}
