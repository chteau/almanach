import { resolve } from 'node:path';
import { z } from 'zod';

const booleanFromEnv = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().min(1).default('0.0.0.0'),
  COOKIE_SECURE: booleanFromEnv.default(true),
  TRUST_PROXY: booleanFromEnv.default(false),
  ALMANACH_INSTALL_TOKEN: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined))
    .pipe(z.string().min(32).optional()),
  WEB_DIST: z.string().default(resolve(import.meta.dir, '../../web/dist')),
  SMTP_URL: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined))
    .pipe(z.url({ protocol: /^smtps?$/ }).optional()),
  SMTP_FROM: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined))
    .pipe(z.string().min(3).max(200).optional()),
  REMINDERS: booleanFromEnv.default(true),
  PACK_PUBLIC_KEYS: z
    .string()
    .optional()
    .transform((value) =>
      (value ?? '')
        .split(',')
        .map((key) => key.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().regex(/^[A-Za-z0-9_-]{43}$/)).max(10)),
  PACK_UPDATE_URL: z
    .string()
    .optional()
    .transform((value) => (value ? value : undefined))
    .pipe(z.url({ protocol: /^https$/ }).optional()),
  /** Puts the whole instance in maintenance, for example during a manual backup restore (S-272). */
  MAINTENANCE: booleanFromEnv.default(false),
  SECRETS_KEY: z
    .string()
    .optional()
    .transform((value) => (value ? Buffer.from(value, 'base64') : undefined))
    .refine((key) => key === undefined || key.length === 32, 'secrets_key_length'),
  /** The server administrator allows Stripe syncs here instead of in Settings → Instance. */
  STRIPE_SYNC: booleanFromEnv.default(false),
  /** The server administrator allows links between instances here instead of in Settings → Instance. */
  FEDERATION: booleanFromEnv.default(false),
  RELEASE_CHECK_URL: z
    .url({ protocol: /^https$/ })
    .default('https://api.github.com/repos/chteau/almanach/releases/latest'),
});

/** Validated runtime configuration. */
export interface Config {
  databaseUrl: string;
  port: number;
  host: string;
  cookieSecure: boolean;
  trustProxy: boolean;
  presetInstallToken: string | undefined;
  webDist: string;
  /** SMTP connection URL, e.g. smtps://user:password@mail.example.com:465; e-mail is off when absent. */
  smtpUrl: string | undefined;
  smtpFrom: string | undefined;
  /** Background reminder job; tests turn it off. */
  reminders: boolean;
  /** Ed25519 public keys (raw, base64url) trusted to sign country pack updates. */
  packPublicKeys: string[];
  /** HTTPS folder publishing signed pack bundles and their index.json; checked daily when set. */
  packUpdateUrl: string | undefined;
  /** Serve only the maintenance page and 503 answers (S-272). */
  maintenance: boolean;
  /** GitHub "latest release" endpoint, queried daily only when an administrator allows it (S-273). */
  releaseCheckUrl: string;
  /** Key encrypting stored secrets (Stripe keys); without it, no secret can be saved. */
  secretsKey: Buffer | undefined;
  /** STRIPE_SYNC=true: Stripe syncs allowed by the server configuration, locked on in the interface. */
  stripeSync: boolean;
  /** FEDERATION=true: links between instances allowed by the server configuration, locked on in the interface. */
  federation: boolean;
}

/**
 * Reads and validates the configuration from environment variables, failing fast on bad values
 *
 * @param env {Record<string, string | undefined>} - environment to read, process.env by default
 * @returns {Config} - the validated configuration
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid configuration: ${fields}. See .env.example.`);
  }
  const value = parsed.data;
  return {
    databaseUrl: value.DATABASE_URL,
    port: value.PORT,
    host: value.HOST,
    cookieSecure: value.COOKIE_SECURE,
    trustProxy: value.TRUST_PROXY,
    presetInstallToken: value.ALMANACH_INSTALL_TOKEN,
    webDist: resolve(value.WEB_DIST),
    smtpUrl: value.SMTP_URL,
    smtpFrom: value.SMTP_FROM,
    reminders: value.REMINDERS,
    packPublicKeys: value.PACK_PUBLIC_KEYS,
    packUpdateUrl: value.PACK_UPDATE_URL,
    maintenance: value.MAINTENANCE,
    releaseCheckUrl: value.RELEASE_CHECK_URL,
    secretsKey: value.SECRETS_KEY,
    stripeSync: value.STRIPE_SYNC,
    federation: value.FEDERATION,
  };
}
