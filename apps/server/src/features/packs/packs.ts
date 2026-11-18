import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  isLuhnValid,
  type PackMeta,
  type ProfileInput,
  packMetaSchema,
  type YearRules,
  yearRulesSchema,
} from '@almanach/shared';

/** Default location of the bundled country packs. */
export const PACKS_DIR = resolve(import.meta.dir, '../../../../../packs');

/** Read-only registry of the country packs available on this instance. */
export class PackRegistry {
  /**
   * Creates the registry from already validated packs
   *
   * @param packs {Map<string, PackMeta>} - packs keyed by ISO country code
   */
  constructor(
    private readonly packs: Map<string, PackMeta>,
    private readonly yearRules: Map<string, Map<number, YearRules>> = new Map(),
  ) {}

  /** Packs shipped with the application, kept to restore them after a signed update is rolled back. */
  private builtin = new Map<string, { meta: PackMeta; years: Map<number, YearRules> }>();

  /**
   * Loads every country pack (pack.yaml) and its yearly rules (YYYY.yaml) from a directory,
   * validating them so a malformed pack stops the server at start-up
   *
   * @param dir {string} - directory containing one sub-directory per country
   * @returns {Promise<PackRegistry>} - the registry
   */
  static async load(dir: string = PACKS_DIR): Promise<PackRegistry> {
    const registry = new PackRegistry(new Map(), new Map());
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const files: Record<string, string> = {};
      for (const name of await readdir(resolve(dir, entry.name))) {
        if (name === 'pack.yaml' || /^\d{4}\.yaml$/.test(name))
          files[name] = await Bun.file(resolve(dir, entry.name, name)).text();
      }
      if (!files['pack.yaml']) continue;
      const parsed = parseCountryFiles(entry.name, files);
      registry.apply(parsed.meta, parsed.years);
      registry.builtin.set(parsed.meta.country, parsed);
    }
    return registry;
  }

  /**
   * Replaces the pack of a country, e.g. after a signed update is installed
   *
   * @param meta {PackMeta} - pack metadata
   * @param years {Map<number, YearRules>} - yearly rules
   * @returns {void} - nothing
   */
  apply(meta: PackMeta, years: Map<number, YearRules>): void {
    this.packs.set(meta.country, meta);
    this.yearRules.set(meta.country, years);
  }

  /**
   * Goes back to the pack shipped with the application
   *
   * @param country {string} - ISO country code
   * @returns {boolean} - false when no pack of that country is shipped
   */
  restoreBuiltin(country: string): boolean {
    const shipped = this.builtin.get(country);
    if (!shipped) return false;
    this.apply(shipped.meta, shipped.years);
    return true;
  }

  list(): PackMeta[] {
    return [...this.packs.values()].sort((a, b) => a.country.localeCompare(b.country));
  }

  /**
   * Returns the pack of a country
   *
   * @param country {string} - ISO country code
   * @returns {PackMeta | undefined} - the pack, or undefined in generic mode
   */
  get(country: string): PackMeta | undefined {
    return this.packs.get(country);
  }

  /**
   * Rules of a fiscal year; when that year is not published yet, the closest earlier year is used and
   * flagged so the interface can say so (S-049, S-324)
   *
   * @param country {string} - ISO country code
   * @param year {number} - fiscal year (calendar year it starts in)
   * @returns {{ rules: YearRules; fallback: boolean } | undefined} - rules, or undefined when the pack has none
   */
  rules(country: string, year: number): { rules: YearRules; fallback: boolean } | undefined {
    const years = this.yearRules.get(country);
    if (!years || years.size === 0) return undefined;
    const exact = years.get(year);
    if (exact) return { rules: exact, fallback: false };
    const known = [...years.keys()].sort((a, b) => a - b);
    const closest = [...known].reverse().find((candidate) => candidate < year) ?? known[0];
    const rules = closest === undefined ? undefined : years.get(closest);
    return rules ? { rules, fallback: true } : undefined;
  }

  /**
   * Every public holiday known for a country, across years, for moving deadlines off non-working days
   *
   * @param country {string} - ISO country code
   * @returns {Set<string>} - dates as YYYY-MM-DD
   */
  holidays(country: string): Set<string> {
    const dates = new Set<string>();
    for (const rules of this.yearRules.get(country)?.values() ?? []) {
      for (const holiday of rules.holidays) if (!holiday.appliesTo) dates.add(holiday.date);
    }
    return dates;
  }

  /**
   * Rules in use for a country, per year
   *
   * @param country {string} - ISO country code
   * @returns {Map<number, YearRules>} - rules by year, empty when unknown
   */
  yearsOf(country: string): Map<number, YearRules> {
    return new Map(this.yearRules.get(country) ?? []);
  }

  /**
   * Years with published rules for a country
   *
   * @param country {string} - ISO country code
   * @returns {number[]} - years in ascending order
   */
  publishedYears(country: string): number[] {
    return [...(this.yearRules.get(country)?.keys() ?? [])].sort((a, b) => a - b);
  }
}

/**
 * Validates the files of one country pack: pack.yaml and any YYYY.yaml rules
 *
 * @param label {string} - name used in error messages
 * @param files {Record<string, string>} - file name to YAML text
 * @returns {{ meta: PackMeta; years: Map<number, YearRules> }} - parsed pack
 */
export function parseCountryFiles(
  label: string,
  files: Record<string, string>,
): { meta: PackMeta; years: Map<number, YearRules> } {
  const parsed = packMetaSchema.safeParse(Bun.YAML.parse(files['pack.yaml'] ?? ''));
  if (!parsed.success) throw new Error(`Invalid country pack ${label}: ${parsed.error.message}`);
  const years = new Map<number, YearRules>();
  for (const [name, text] of Object.entries(files)) {
    const match = /^(\d{4})\.yaml$/.exec(name);
    if (!match) continue;
    const rules = yearRulesSchema.safeParse(Bun.YAML.parse(text));
    if (!rules.success) throw new Error(`Invalid rules ${label}/${name}: ${rules.error.message}`);
    if (rules.data.year !== Number(match[1]))
      throw new Error(`Rules ${label}/${name} declare year ${rules.data.year}`);
    years.set(rules.data.year, rules.data);
  }
  return { meta: parsed.data, years };
}

/**
 * Checks a profile against its country pack; countries without a pack only get generic rules (S-021)
 *
 * @param profile {Pick<ProfileInput, 'status' | 'declarationPeriod' | 'options' | 'identifiers'>} - profile fields
 * @param pack {PackMeta | undefined} - pack of the profile's country
 * @returns {{ path: string; message: string }[]} - issues, empty when the profile is consistent
 */
export function profileIssues(
  profile: Pick<ProfileInput, 'status' | 'declarationPeriod' | 'options' | 'identifiers'>,
  pack: PackMeta | undefined,
): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (!pack) {
    if (profile.status || profile.declarationPeriod || profile.options.length > 0) {
      issues.push({ path: 'status', message: 'no_pack' });
    }
    return issues;
  }
  if (!pack.statuses.some((status) => status.id === profile.status)) {
    issues.push({ path: 'status', message: 'unknown_status' });
  }
  if (!profile.declarationPeriod || !pack.declarationPeriods.includes(profile.declarationPeriod)) {
    issues.push({ path: 'declarationPeriod', message: 'unknown_period' });
  }
  for (const option of profile.options) {
    if (!pack.options.some((known) => known.id === option))
      issues.push({ path: 'options', message: 'unknown_option' });
  }
  for (const key of Object.keys(profile.identifiers)) {
    if (!pack.identifiers.some((identifier) => identifier.id === key)) {
      issues.push({ path: `identifiers.${key}`, message: 'unknown_identifier' });
    }
  }
  for (const identifier of pack.identifiers) {
    const value = normalizeIdentifier(profile.identifiers[identifier.id] ?? '');
    if (!value) {
      if (identifier.required) issues.push({ path: `identifiers.${identifier.id}`, message: 'required' });
      continue;
    }
    const valid =
      new RegExp(identifier.pattern).test(value) && (identifier.checksum !== 'luhn' || isLuhnValid(value));
    if (!valid) issues.push({ path: `identifiers.${identifier.id}`, message: 'invalid_format' });
  }
  return issues;
}

/**
 * Removes spaces and dots people type in identifiers, and upper-cases letters
 *
 * @param value {string} - identifier as typed
 * @returns {string} - normalized identifier
 */
export function normalizeIdentifier(value: string): string {
  return value.replace(/[\s.]/g, '').toUpperCase();
}
