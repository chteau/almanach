import type {
  Bank,
  DeclarationPeriod,
  Line,
  LinkedClient,
  LinkedDocument,
  LinkedPayment,
  Locale,
  NumberFormatPeriod,
  PDF_FONTS,
  PDF_LAYOUTS,
  PostalAddress,
  Situation,
  Totals,
  VatMode,
} from '@almanach/shared';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  check,
  customType,
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
    /** Whether people may turn on the Stripe sync of their companies; off by default. */
    stripeSync: boolean('stripe_sync').notNull().default(false),
    /** Whether people may link their companies with other instances (docs/federation.md); off by default. */
    federation: boolean('federation').notNull().default(false),
    /** Whether people may add external document sources (docs/external-sources.md); off by default. */
    externalSources: boolean('external_sources').notNull().default(false),
    /** Whether the /mcp endpoint answers personal access tokens (docs/mcp.md); off by default. */
    mcp: boolean('mcp').notNull().default(false),
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

/** Companies or other structures a person runs; every business record belongs to exactly one. */
export const companies = pgTable(
  'companies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Read-only Stripe key, AES-256-GCM encrypted with SECRETS_KEY. */
    stripeKey: text('stripe_key'),
    /** Stripe sync is off until the person turns it on; nothing is fetched while off. */
    stripeSync: boolean('stripe_sync').notNull().default(false),
    stripeSyncedAt: timestamp('stripe_synced_at', { withTimezone: true }),
    stripeError: text('stripe_error'),
    /** Links with other instances are off until the person turns them on. */
    federation: boolean('federation').notNull().default(false),
    /** Activity name shown to linked instances, e.g. "SEKLYR". */
    federationLabel: text('federation_label'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('companies_user_idx').on(table.userId)],
);

/**
 * Secondary activities of a company (mixed activity under one business, e.g. BNC + BIC services); the main
 * activity is the profile status. Records without an activity belong to the main one.
 */
export const companyActivities = pgTable(
  'company_activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    /** Link whose announced activity created this one automatically. */
    linkId: uuid('link_id').references((): AnyPgColumn => federationLinks.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('company_activities_status_idx').on(table.companyId, table.status)],
);

/** Activity a record belongs to; null is the main activity. */
const activityColumn = () =>
  uuid('activity_id').references((): AnyPgColumn => companyActivities.id, { onDelete: 'set null' });

/** Personal access tokens for /mcp (docs/mcp.md); only the SHA-256 of the token is stored. */
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    scope: text('scope', { enum: ['read', 'read_drafts', 'read_pipeline'] }).notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('api_tokens_user_idx').on(table.userId)],
);

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
  companyId: uuid('company_id')
    .primaryKey()
    .references(() => companies.id, { onDelete: 'cascade' }),
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
  companyId: uuid('company_id')
    .primaryKey()
    .references(() => companies.id, { onDelete: 'cascade' }),
  step: text('step').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const clients = pgTable(
  'clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['company', 'individual'] }).notNull(),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    address: text('address'),
    /** Structured address (EN 16931 BG-8); `address` stays the printed text. */
    addressLines: jsonb('address_lines').$type<string[]>(),
    postalCode: text('postal_code'),
    city: text('city'),
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
    siret: text('siret'),
    archived: boolean('archived').notNull().default(false),
    /** Stripe customer (cus_…) this client was created from; the sync matches on it. */
    stripeId: text('stripe_id'),
    /** Set once the client is edited in Almanach: the Stripe sync then stops overwriting its fields. */
    stripeEdited: boolean('stripe_edited').notNull().default(false),
    /** When the Stripe customer disappeared; the client and its history are kept. */
    stripeDeletedAt: timestamp('stripe_deleted_at', { withTimezone: true }),
    /** Stripe `livemode` of the customer; false marks test data. Null only before the first backfill. */
    livemode: boolean('livemode'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('clients_user_idx').on(table.companyId),
    uniqueIndex('clients_stripe_idx').on(table.companyId, table.stripeId),
  ],
);

export const missions = pgTable(
  'missions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
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
  (table) => [
    index('missions_user_idx').on(table.companyId),
    index('missions_client_idx').on(table.clientId),
  ],
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
  /** Structured address for the e-invoice; absent on documents issued before it existed. */
  postal?: PostalAddress | null;
}

/** Quotes, invoices, deposit invoices and credit notes share one table and one line format. */
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
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
    activityId: activityColumn(),
    vatMode: text('vat_mode').$type<VatMode>().notNull(),
    mentions: jsonb('mentions').$type<string[]>().notNull(),
    totals: jsonb('totals').$type<Totals>().notNull(),
    /** Factur-X produced with the PDF; frozen at issue. */
    einvoiceFormat: text('einvoice_format').$type<'facturx'>(),
    seller: jsonb('seller').$type<PartySnapshot>(),
    buyer: jsonb('buyer').$type<PartySnapshot>(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('documents_user_idx').on(table.companyId, table.type),
    uniqueIndex('documents_number_unique').on(table.companyId, table.number),
  ],
);

/** Last number used per user, document family and year; locked while issuing so numbers never repeat. */
export const numberSequences = pgTable(
  'number_sequences',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    family: text('family').notNull(),
    year: integer('year').notNull(),
    last: integer('last').notNull(),
  },
  (table) => [primaryKey({ columns: [table.companyId, table.family, table.year] })],
);

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'restrict' }),
    date: date('date').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    receivedCents: bigint('received_cents', { mode: 'number' }),
    feesCents: bigint('fees_cents', { mode: 'number' }).notNull(),
    method: text('method').notNull(),
    reference: text('reference'),
    /** Null follows the activity of the document. */
    activityId: activityColumn(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('payments_document_idx').on(table.documentId),
    index('payments_user_date_idx').on(table.companyId, table.date),
  ],
);

/** What a person recorded about a pack or custom deadline occurrence: done, hidden, amount paid (S-064 to S-066, S-083). */
export const deadlineMarks = pgTable(
  'deadline_marks',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    doneOn: date('done_on'),
    note: text('note'),
    actualCents: bigint('actual_cents', { mode: 'number' }),
    /** Figures copied into the form, per prepared line id. */
    declared: jsonb('declared').$type<Record<string, number>>(),
    hidden: boolean('hidden').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.companyId, table.key] })],
);

/** Commercial pipeline: a lead, its quote, follow-ups, until won or lost (lighter than a mission). */
export const deals = pgTable(
  'deals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    activityId: activityColumn(),
    /** Null while the prospect is not a client yet; prospectName is then required. */
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'restrict' }),
    prospectName: text('prospect_name'),
    prospectContact: text('prospect_contact'),
    title: text('title').notNull(),
    stage: text('stage', { enum: ['lead', 'quote_sent', 'follow_up', 'won', 'lost'] }).notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }),
    currency: text('currency'),
    /** One quote belongs to one deal at most. */
    quoteId: uuid('quote_id')
      .unique()
      .references(() => documents.id, { onDelete: 'set null' }),
    missionId: uuid('mission_id').references(() => missions.id, { onDelete: 'set null' }),
    nextActionOn: date('next_action_on'),
    nextAction: text('next_action'),
    lostReason: text('lost_reason'),
    closedOn: date('closed_on'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('deals_company_stage_idx').on(table.companyId, table.stage),
    index('deals_company_next_idx').on(table.companyId, table.nextActionOn),
    check('deals_named', sql`${table.clientId} is not null or ${table.prospectName} is not null`),
  ],
);

/** History of a deal: stage changes (manual or from its quote), follow-ups done, notes. */
export const dealEvents = pgTable(
  'deal_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['stage_changed', 'follow_up_done', 'note'] }).notNull(),
    fromStage: text('from_stage'),
    toStage: text('to_stage'),
    note: text('note'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('deal_events_deal_idx').on(table.dealId)],
);

/** Pipeline setting of a company: days between a quote sent and its follow-up. */
export const pipelineSettings = pgTable('pipeline_settings', {
  companyId: uuid('company_id')
    .primaryKey()
    .references(() => companies.id, { onDelete: 'cascade' }),
  followUpDays: integer('follow_up_days').notNull().default(7),
});

/** Raw bytes, for encrypted vault files kept out of every list query. */
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

/** Documents of the vault: insurance certificates, registration extracts, contracts… with an optional expiry. */
export const vaultItems = pgTable(
  'vault_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    activityId: activityColumn(),
    /** Kind id from the country pack or the core (client_contract, other). */
    kind: text('kind').notNull(),
    title: text('title').notNull(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    missionId: uuid('mission_id').references(() => missions.id, { onDelete: 'set null' }),
    issuedOn: date('issued_on'),
    expiresOn: date('expires_on'),
    /** Days before expiry to remind; null keeps the kind's. */
    remindDays: jsonb('remind_days').$type<number[]>(),
    notes: text('notes').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('vault_items_company_expiry_idx').on(table.companyId, table.expiresOn)],
);

/** Encrypted files of the vault; a replaced version is kept one year (supersededAt), then purged. */
export const vaultFiles = pgTable(
  'vault_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => vaultItems.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256: text('sha256').notNull(),
    /** "v1" | iv (12) | tag (16) | AES-256-GCM ciphertext, key derived from SECRETS_KEY. */
    data: bytea('data').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
  },
  (table) => [index('vault_files_item_idx').on(table.itemId)],
);

/** Simple expenses: amount before VAT, VAT paid, category and optional receipt from the vault. */
export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    activityId: activityColumn(),
    date: date('date').notNull(),
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    vatCents: bigint('vat_cents', { mode: 'number' }).notNull().default(0),
    /** Main currency of the company when entered. */
    currency: text('currency').notNull(),
    category: text('category').notNull(),
    description: text('description').notNull().default(''),
    vaultItemId: uuid('vault_item_id').references((): AnyPgColumn => vaultItems.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('expenses_company_date_idx').on(table.companyId, table.date)],
);

/** Amounts from a notice or entered by the person for a deadline rule and fiscal year (prepared declarations). */
export const deadlineNotices = pgTable(
  'deadline_notices',
  {
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    ruleId: text('rule_id').notNull(),
    fiscalYear: integer('fiscal_year').notNull(),
    perOccurrenceCents: bigint('per_occurrence_cents', { mode: 'number' }),
    priorYearTaxCents: bigint('prior_year_tax_cents', { mode: 'number' }),
    priorYearIncomeCents: bigint('prior_year_income_cents', { mode: 'number' }),
    /** Method chosen among those the pack offers; null keeps the pack's default. */
    method: text('method'),
    note: text('note'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.companyId, table.ruleId, table.fiscalYear] })],
);

/** Settings of the tax reserve chosen by the person; absent means the pack's margin and no extra. */
export const reserveSettings = pgTable('reserve_settings', {
  companyId: uuid('company_id')
    .primaryKey()
    .references(() => companies.id, { onDelete: 'cascade' }),
  /** Null keeps the pack's prudent margin. */
  marginBp: integer('margin_bp'),
  extraRateBp: integer('extra_rate_bp').notNull().default(0),
  extraMonthlyCents: bigint('extra_monthly_cents', { mode: 'number' }).notNull().default(0),
  extraNote: text('extra_note'),
  /** Tax household for French income tax: parts in quarters (4 = one part) and joint taxation. */
  taxPartsQuarters: integer('tax_parts_quarters').notNull().default(4),
  jointTaxation: boolean('joint_taxation').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Deadlines a person adds, once or recurring (S-063). */
export const customDeadlines = pgTable(
  'custom_deadlines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    date: date('date').notNull(),
    recurrence: text('recurrence').$type<'none' | 'monthly' | 'quarterly' | 'yearly'>().notNull(),
    until: date('until'),
    notes: text('notes'),
    activityId: activityColumn(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('custom_deadlines_user_idx').on(table.companyId)],
);

/** In-app notifications; the dedupe key makes reminder jobs idempotent across restarts (S-220, S-331). */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
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
    uniqueIndex('notifications_dedupe_idx').on(table.companyId, table.dedupeKey),
    index('notifications_user_created_idx').on(table.companyId, table.createdAt),
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
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
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
    index('time_entries_user_date_idx').on(table.companyId, table.date),
    // At most one running timer per person (S-131).
    uniqueIndex('time_entries_running_idx').on(table.companyId).where(sql`${table.startedAt} IS NOT NULL`),
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
  companyId: uuid('company_id')
    .primaryKey()
    .references(() => companies.id, { onDelete: 'cascade' }),
  /** Formats with the first year each applies to; a change after the first invoice waits for next year. */
  numbering: jsonb('numbering').$type<NumberFormatPeriod[]>().notNull(),
  pdf: jsonb('pdf')
    .$type<{ accent: string; layout: (typeof PDF_LAYOUTS)[number]; font: (typeof PDF_FONTS)[number] }>()
    .notNull(),
  defaultTermsDays: integer('default_terms_days').notNull().default(30),
  defaultNote: text('default_note'),
  facturxDefault: boolean('facturx_default').notNull().default(false),
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
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    effectiveOn: date('effective_on').notNull(),
    before: jsonb('before').$type<Situation>().notNull(),
    after: jsonb('after').$type<Situation>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('situation_changes_user_date_idx').on(table.companyId, table.effectiveOn)],
);

/** Receipts collected outside Almanach invoices (Stripe); refunds are negative. Count in revenue like payments. */
export const externalRevenues = pgTable(
  'external_revenues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    source: text('source', { enum: ['stripe'] }).notNull(),
    /** Identifier at the source (Stripe invoice, charge or refund id), so a sync never imports twice. */
    externalId: text('external_id').notNull(),
    date: date('date').notNull(),
    /** Amount before tax when the source gives it, in `currency`. */
    amountCents: bigint('amount_cents', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    /** Same amount in the company currency when `currency` differs and the source converted it. */
    receivedCents: bigint('received_cents', { mode: 'number' }),
    client: text('client'),
    /** Almanach client of the paying Stripe customer, when known. */
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    reference: text('reference'),
    /** Stripe `livemode` of the object; false marks test data, left out of every total. */
    livemode: boolean('livemode'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('external_revenues_source_idx').on(table.companyId, table.source, table.externalId),
    index('external_revenues_company_date_idx').on(table.companyId, table.date),
  ],
);

/**
 * Link with another Almanach instance tracking another activity of the same business: only monthly
 * totals per fiscal category travel through it (docs/federation.md).
 */
export const federationLinks = pgTable(
  'federation_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    /** pending: code issued, waiting for the other side; imported: restored from an export, to pair again. */
    state: text('state', { enum: ['pending', 'active', 'imported'] }).notNull(),
    /** SHA-256 of the one-time pairing secret, cleared once used. */
    codeHash: text('code_hash'),
    codeExpiresAt: timestamp('code_expires_at', { withTimezone: true }),
    peerUrl: text('peer_url'),
    /** Ed25519 key of this side for this link: raw public key, PKCS#8 private key encrypted with SECRETS_KEY. */
    publicKey: text('public_key'),
    privateKey: text('private_key'),
    peerPublicKey: text('peer_public_key'),
    /** Fingerprint of the peer key, naming the link in signed requests. */
    peerKeyId: text('peer_key_id'),
    share: boolean('share').notNull().default(true),
    receive: boolean('receive').notNull().default(true),
    /** Whether this side calls the other one; the side behind a VPN may be the only one able to. */
    pulls: boolean('pulls').notNull().default(false),
    /** Whether this side shares its clients, documents and payments read-only; off by default. */
    shareDetail: boolean('share_detail').notNull().default(false),
    /** Whether this side keeps the detail the other one shares; off by default. */
    receiveDetail: boolean('receive_detail').notNull().default(false),
    /** Whether the peer said it keeps this side's detail; learnt from its answers, nothing is sent before. */
    peerReceivesDetail: boolean('peer_receives_detail').notNull().default(false),
    peerLabel: text('peer_label'),
    peerCurrency: text('peer_currency'),
    /** Status of the main activity the peer announces in its exchanges; null for an older peer. */
    peerActivity: text('peer_activity'),
    /** Whether the attachment follows the announced activity; false once chosen by hand. */
    activityAuto: boolean('activity_auto').notNull().default(true),
    /** The received revenue counts as the main activity. */
    activityMain: boolean('activity_main').notNull().default(false),
    /** The received revenue counts as this secondary activity. Neither: thresholds only, by category. */
    activityId: activityColumn(),
    /** Last exchange, whichever side called. */
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    /** When the totals kept below were received. */
    receivedAt: timestamp('received_at', { withTimezone: true }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('federation_links_company_idx').on(table.companyId),
    uniqueIndex('federation_links_peer_key_idx').on(table.peerKeyId),
    uniqueIndex('federation_links_code_idx').on(table.codeHash),
  ],
);

/** Revenue of the linked activity, per calendar month and fiscal category, as last received. */
export const federationTotals = pgTable(
  'federation_totals',
  {
    linkId: uuid('link_id')
      .notNull()
      .references(() => federationLinks.id, { onDelete: 'cascade' }),
    month: text('month').notNull(),
    category: text('category').notNull(),
    cents: bigint('cents', { mode: 'number' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.linkId, table.month, table.category] })],
);

/** Nonces of signed federation requests seen within the signature window, so none is accepted twice. */
export const federationNonces = pgTable(
  'federation_nonces',
  {
    keyId: text('key_id').notNull(),
    nonce: text('nonce').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.keyId, table.nonce] })],
);

/**
 * Read-only copies of the records a linked instance shares, one table per kind, keyed by link and remote id.
 * Never mixed with local records: they take no part in numbering, declarations, estimates or exports, and go
 * with the link or as soon as either side stops sharing.
 */
const linkedTable = <T>(name: string) =>
  pgTable(
    name,
    {
      linkId: uuid('link_id')
        .notNull()
        .references(() => federationLinks.id, { onDelete: 'cascade' }),
      remoteId: uuid('remote_id').notNull(),
      data: jsonb('data').$type<T>().notNull(),
    },
    (table) => [primaryKey({ columns: [table.linkId, table.remoteId] })],
  );

export const federationClients = linkedTable<LinkedClient>('federation_clients');
export const federationDocuments = linkedTable<LinkedDocument>('federation_documents');
export const federationPayments = linkedTable<LinkedPayment>('federation_payments');

/** HTTPS feed of documents from another tool, polled like a link (docs/external-sources.md). */
export const externalSources = pgTable(
  'external_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    url: text('url').notNull(),
    /** Bearer token, AES-256-GCM encrypted with SECRETS_KEY; never sent back to the interface. */
    token: text('token').notNull(),
    /** Test environment: its records show as test data and stay out of every total. */
    test: boolean('test').notNull().default(false),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    error: text('error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('external_sources_company_idx').on(table.companyId)],
);

/** Read-only copies of a source's records, replaced at each poll and gone with the source. */
const sourceTable = <T>(name: string) =>
  pgTable(
    name,
    {
      linkId: uuid('source_id')
        .notNull()
        .references(() => externalSources.id, { onDelete: 'cascade' }),
      remoteId: uuid('remote_id').notNull(),
      data: jsonb('data').$type<T>().notNull(),
    },
    (table) => [primaryKey({ columns: [table.linkId, table.remoteId] })],
  );

export const externalClients = sourceTable<LinkedClient>('external_clients');
export const externalDocuments = sourceTable<LinkedDocument>('external_documents');

/**
 * Outgoing e-mail set in Settings → Instance (docs/email.md), one row at most; SMTP_URL in the environment wins
 * over it. Secrets are AES-256-GCM encrypted with SECRETS_KEY and never sent back to the interface.
 */
export const mailSettings = pgTable(
  'mail_settings',
  {
    id: integer('id').primaryKey().default(1),
    provider: text('provider').notNull(),
    host: text('host').notNull(),
    port: integer('port').notNull(),
    security: text('security', { enum: ['tls', 'starttls'] }).notNull(),
    username: text('username').notNull(),
    fromAddress: text('from_address').notNull(),
    /** SMTP password or app password, encrypted. */
    passwordEnc: text('password_enc'),
    /** Microsoft refresh token (Outlook), encrypted; replaced by the rotated one at each refresh. */
    oauthRefreshEnc: text('oauth_refresh_enc'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (table) => [check('mail_settings_singleton', sql`${table.id} = 1`)],
);
