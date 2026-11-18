import type {
  Bank,
  DeclarationPeriod,
  Line,
  Locale,
  NumberFormatPeriod,
  PDF_FONTS,
  PDF_LAYOUTS,
  Situation,
  Totals,
  VatMode,
} from '@almanach/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Singleton row describing the instance; its presence means installation is complete. */
export const instance = pgTable(
  'instance',
  {
    id: integer('id').primaryKey(),
    name: text('name').notNull(),
    publicUrl: text('public_url').notNull(),
    timezone: text('timezone').notNull(),
    defaultLocale: text('default_locale').notNull(),
    /** Daily check for signed pack updates (S-244a); off by default, nothing is fetched while off. */
    packAutoCheck: boolean('pack_auto_check').notNull().default(false),
    /** Daily check for a new Almanach release (S-273); off by default. */
    versionCheck: boolean('version_check').notNull().default(false),
    installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check('instance_singleton', sql`${table.id} = 1`)],
);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role', { enum: ['admin', 'member'] }).notNull(),
  locale: text('locale').notNull(),
  /** Base32 TOTP secret once two-factor sign-in is confirmed. */
  totpSecret: text('totp_secret'),
  /** Secret shown during setup, until a first code confirms it. */
  totpPending: text('totp_pending'),
  /** Last accepted TOTP time step, so a code cannot be replayed. */
  totpLastStep: bigint('totp_last_step', { mode: 'number' }),
  /** SHA-256 of the unused recovery codes. */
  recoveryCodes: jsonb('recovery_codes').$type<string[]>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Server-side sessions; only the SHA-256 of the cookie token is stored. */
export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  ip: text('ip'),
  userAgent: text('user_agent'),
});

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  meta: jsonb('meta'),
  ip: text('ip'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Fiscal and company profile of a person, filled during onboarding. */
export const profiles = pgTable('profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  country: text('country').notNull(),
  status: text('status'),
  activityStart: date('activity_start').notNull(),
  declarationPeriod: text('declaration_period').$type<DeclarationPeriod>(),
  options: jsonb('options').$type<string[]>().notNull(),
  identifiers: jsonb('identifiers').$type<Record<string, string>>().notNull(),
  currency: text('currency').notNull(),
  bank: jsonb('bank').$type<Bank>().notNull(),
  company: jsonb('company')
    .$type<{ name: string; address: string; email: string; phone: string | null; website: string | null }>()
    .notNull(),
  priorRevenueCents: bigint('prior_revenue_cents', { mode: 'number' }),
  /** Last day of activity; the account is read-only from the next day (S-233). */
  ceasedOn: date('ceased_on'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Onboarding progress kept on the server so a person resumes where they stopped (S-032). */
export const onboardingDrafts = pgTable('onboarding_drafts', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  step: text('step').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const clients = pgTable(
  'clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['company', 'individual'] }).notNull(),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    address: text('address'),
    country: text('country').notNull(),
    vatNumber: text('vat_number'),
    currency: text('currency').notNull(),
    language: text('language').$type<Locale>().notNull(),
    paymentTermsDays: integer('payment_terms_days').notNull(),
    contacts: jsonb('contacts')
      .$type<
        { name: string; email: string | null; phone: string | null; role: string | null; billing: boolean }[]
      >()
      .notNull(),
    notes: text('notes'),
    archived: boolean('archived').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('clients_user_idx').on(table.userId)],
);

export const missions = pgTable(
  'missions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    status: text('status', { enum: ['prospect', 'active', 'done', 'cancelled'] }).notNull(),
    billing: text('billing', { enum: ['fixed', 'daily', 'hourly', 'monthly'] }).notNull(),
    rateCents: bigint('rate_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date'),
    budgetCents: bigint('budget_cents', { mode: 'number' }),
    endClient: text('end_client'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('missions_user_idx').on(table.userId), index('missions_client_idx').on(table.clientId)],
);

/** Seller and client details frozen on a document when it is issued, so later edits never change it. */
export interface PartySnapshot {
  name: string;
  address: string | null;
  country: string;
  email: string | null;
  vatNumber: string | null;
  identifiers: Record<string, string>;
  bank?: Bank;
}

/** Quotes, invoices, deposit invoices and credit notes share one table and one line format. */
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['quote', 'invoice', 'deposit', 'credit_note'] }).notNull(),
    state: text('state', { enum: ['draft', 'issued', 'sent', 'accepted', 'declined'] }).notNull(),
    number: text('number'),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    missionId: uuid('mission_id').references(() => missions.id, { onDelete: 'set null' }),
    relatedId: uuid('related_id'),
    issueDate: date('issue_date').notNull(),
    dueDate: date('due_date'),
    validUntil: date('valid_until'),
    language: text('language').$type<Locale>().notNull(),
    currency: text('currency').notNull(),
    lines: jsonb('lines').$type<Line[]>().notNull(),
    discountBp: integer('discount_bp').notNull(),
    note: text('note'),
    depositIds: jsonb('deposit_ids').$type<string[]>().notNull(),
    vatMode: text('vat_mode').$type<VatMode>().notNull(),
    mentions: jsonb('mentions').$type<string[]>().notNull(),
    totals: jsonb('totals').$type<Totals>().notNull(),
    seller: jsonb('seller').$type<PartySnapshot>(),
    buyer: jsonb('buyer').$type<PartySnapshot>(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('documents_user_idx').on(table.userId, table.type),
    uniqueIndex('documents_number_unique').on(table.userId, table.number),
  ],
);

/** Last number used per user, document family and year; locked while issuing so numbers never repeat. */
export const numberSequences = pgTable(
  'number_sequences',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    family: text('family').notNull(),
    year: integer('year').notNull(),
    last: integer('last').notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.family, table.year] })],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    date: date('date').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    receivedCents: bigint('received_cents', { mode: 'number' }),
    feesCents: bigint('fees_cents', { mode: 'number' }).notNull(),
    method: text('method').notNull(),
    reference: text('reference'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('payments_document_idx').on(table.documentId),
    index('payments_user_date_idx').on(table.userId, table.date),
  ],
);

/** What a person recorded about a pack or custom deadline occurrence: done, hidden, amount paid (S-064 to S-066, S-083). */
export const deadlineMarks = pgTable(
  'deadline_marks',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    doneOn: date('done_on'),
    note: text('note'),
    actualCents: bigint('actual_cents', { mode: 'number' }),
    hidden: boolean('hidden').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.key] })],
);

/** Deadlines a person adds, once or recurring (S-063). */
export const customDeadlines = pgTable(
  'custom_deadlines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    date: date('date').notNull(),
    recurrence: text('recurrence').$type<'none' | 'monthly' | 'quarterly' | 'yearly'>().notNull(),
    until: date('until'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('custom_deadlines_user_idx').on(table.userId)],
);

/** In-app notifications; the dedupe key makes reminder jobs idempotent across restarts (S-220, S-331). */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    params: jsonb('params').$type<Record<string, string | number>>().notNull(),
    link: text('link'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
    /** When the push or e-mail went out; null while waiting (quiet hours, channel down). */
    pushedAt: timestamp('pushed_at', { withTimezone: true }),
    pushAttempts: integer('push_attempts').notNull().default(0),
  },
  (table) => [
    uniqueIndex('notifications_dedupe_idx').on(table.userId, table.dedupeKey),
    index('notifications_user_created_idx').on(table.userId, table.createdAt),
  ],
);

/** Per-person preferences for reminders and the calendar feed. */
export const userSettings = pgTable('user_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** SHA-256 of the secret iCal token; the token itself is shown once (S-068). */
  icalTokenHash: text('ical_token_hash'),
  ntfy: jsonb('ntfy').$type<{ server: string; topic: string; token: string | null } | null>(),
  emailReminders: boolean('email_reminders').notNull().default(true),
  reminderDays: jsonb('reminder_days').$type<number[]>().notNull().default([7, 1, 0]),
  quietHours: jsonb('quiet_hours').$type<{ start: string; end: string } | null>(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Time spent on a mission; locked once invoiced (P11). A running timer has `startedAt` and no minutes yet. */
export const timeEntries = pgTable(
  'time_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    missionId: uuid('mission_id')
      .notNull()
      .references(() => missions.id, { onDelete: 'restrict' }),
    date: date('date').notNull(),
    minutes: integer('minutes').notNull(),
    billable: boolean('billable').notNull().default(true),
    note: text('note'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('time_entries_user_date_idx').on(table.userId, table.date),
    // At most one running timer per person (S-131).
    uniqueIndex('time_entries_running_idx').on(table.userId).where(sql`${table.startedAt} IS NOT NULL`),
    check('time_entries_minutes_check', sql`${table.minutes} >= 0 AND ${table.minutes} <= 1440`),
  ],
);

/** Signed country pack updates; the active row of a country overrides the pack shipped with the app. */
export const packBundles = pgTable(
  'pack_bundles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    country: text('country').notNull(),
    /** Increasing number chosen by the publisher; an older bundle can never be imported over a newer one. */
    sequence: integer('sequence').notNull(),
    keyId: text('key_id').notNull(),
    /** Signed JSON payload, kept verbatim so the signature can be checked again. */
    payload: text('payload').notNull(),
    signature: text('signature').notNull(),
    active: boolean('active').notNull().default(false),
    installedBy: uuid('installed_by').references(() => users.id, { onDelete: 'set null' }),
    installedAt: timestamp('installed_at', { withTimezone: true }).notNull().defaultNow(),
    /** First time the bundle was applied; null while it waits for a decision (S-244b). */
    appliedAt: timestamp('applied_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('pack_bundles_country_sequence_idx').on(table.country, table.sequence),
    uniqueIndex('pack_bundles_active_idx').on(table.country).where(sql`${table.active}`),
  ],
);

/** Numbering, PDF look and defaults chosen by the user (S-234 to S-236). */
export const billingSettings = pgTable('billing_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Formats with the first year each applies to; a change after the first invoice waits for next year. */
  numbering: jsonb('numbering').$type<NumberFormatPeriod[]>().notNull(),
  pdf: jsonb('pdf')
    .$type<{ accent: string; layout: (typeof PDF_LAYOUTS)[number]; font: (typeof PDF_FONTS)[number] }>()
    .notNull(),
  defaultTermsDays: integer('default_terms_days').notNull().default(30),
  defaultNote: text('default_note'),
  /** Base64 PNG or JPEG, at most 256 KB once decoded. */
  logo: text('logo'),
  logoMime: text('logo_mime'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Status or country changes, each with the situation before and after its effective date (S-231, S-232). */
export const situationChanges = pgTable(
  'situation_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    effectiveOn: date('effective_on').notNull(),
    before: jsonb('before').$type<Situation>().notNull(),
    after: jsonb('after').$type<Situation>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('situation_changes_user_date_idx').on(table.userId, table.effectiveOn)],
);
