import { z } from 'zod';

/** How the SMTP connection is secured: implicit TLS from the first byte, or STARTTLS upgrade, mandatory. */
export type MailSecurity = 'tls' | 'starttls';

/** One SMTP endpoint a provider documents. */
export interface MailPreset {
  host: string;
  /** Allowed ports with the security each one requires; the first one is the default. */
  ports: { port: number; security: MailSecurity }[];
  /** `password` (app password, SMTP token, Bridge password) or Microsoft OAuth2 (`oauth2`). */
  auth: 'password' | 'oauth2';
}

export const PROVIDERS = [
  'gmail',
  'icloud',
  'yahoo',
  'fastmail',
  'ovh',
  'infomaniak',
  'proton_bridge',
  'proton_token',
  'outlook',
  'other',
] as const;

/** Provider identifiers accepted by the API. */
export type MailProvider = (typeof PROVIDERS)[number];

const TLS = { port: 465, security: 'tls' } as const;
const STARTTLS = { port: 587, security: 'starttls' } as const;

/**
 * SMTP endpoints of the supported providers, as their help pages document them (docs/email.md). `other` takes
 * any host on 465 or 587; `proton_bridge` any port but port 25, on a loopback address only.
 */
export const MAIL_PRESETS: Record<Exclude<MailProvider, 'other'>, MailPreset> = {
  gmail: { host: 'smtp.gmail.com', ports: [TLS, STARTTLS], auth: 'password' },
  icloud: { host: 'smtp.mail.me.com', ports: [STARTTLS], auth: 'password' },
  yahoo: { host: 'smtp.mail.yahoo.com', ports: [TLS, STARTTLS], auth: 'password' },
  fastmail: { host: 'smtp.fastmail.com', ports: [TLS, STARTTLS], auth: 'password' },
  ovh: { host: 'ssl0.ovh.net', ports: [TLS, STARTTLS], auth: 'password' },
  infomaniak: { host: 'mail.infomaniak.com', ports: [TLS, STARTTLS], auth: 'password' },
  proton_bridge: { host: '127.0.0.1', ports: [{ port: 1025, security: 'starttls' }], auth: 'password' },
  proton_token: { host: 'smtp.protonmail.ch', ports: [STARTTLS], auth: 'password' },
  outlook: { host: 'smtp-mail.outlook.com', ports: [STARTTLS], auth: 'oauth2' },
};

const HOST =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$|^::1$/;
const ADDRESS = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const NAMED_ADDRESS = /^[^<>"\r\n]{1,100}<[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+>$/;

/** Body of PUT /api/settings/mail; the password is optional (omitted keeps the stored one). */
export const mailSettingsSchema = z.strictObject({
  provider: z.enum(PROVIDERS),
  host: z.string().trim().toLowerCase().max(253).regex(HOST),
  port: z.int().min(1).max(65535),
  security: z.enum(['tls', 'starttls']),
  username: z
    .string()
    .trim()
    .min(1)
    .max(320)
    .regex(/^[^\r\n]+$/),
  from: z
    .string()
    .trim()
    .max(320)
    .refine((value) => ADDRESS.test(value) || NAMED_ADDRESS.test(value), 'invalid_address'),
  password: z
    .string()
    .min(1)
    .max(512)
    .regex(/^[^\r\n]+$/)
    .optional(),
});

/** Validated mail settings. */
export type MailSettingsInput = z.output<typeof mailSettingsSchema>;

/**
 * This function tells whether a host is a loopback address, the only place a Proton Mail Bridge may listen
 *
 * @param host {string} - host name or address
 * @returns {boolean} - true for localhost, 127.0.0.0/8 and ::1
 */
export function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/**
 * This function checks a provider, host, port and security against the presets: port 25 is always refused, other
 * providers use 465 (implicit TLS) or 587 (STARTTLS) as their documentation says, Proton Bridge any port on loopback
 *
 * @param input {Pick<MailSettingsInput, 'provider' | 'host' | 'port' | 'security'>} - settings to check
 * @returns {{ error: 'port_not_allowed' } | { field: 'host' | 'security'; message: string } | null} - null when allowed
 */
export function checkEndpoint(
  input: Pick<MailSettingsInput, 'provider' | 'host' | 'port' | 'security'>,
): { error: 'port_not_allowed' } | { field: 'host' | 'security'; message: string } | null {
  if (input.port === 25) return { error: 'port_not_allowed' };
  if (input.provider === 'proton_bridge') {
    return isLoopback(input.host) ? null : { field: 'host', message: 'loopback_required' };
  }
  const ports = input.provider === 'other' ? [TLS, STARTTLS] : MAIL_PRESETS[input.provider].ports;
  if (input.provider !== 'other' && input.host !== MAIL_PRESETS[input.provider].host) {
    return { field: 'host', message: 'preset_host' };
  }
  const match = ports.find((entry) => entry.port === input.port);
  if (!match) return { error: 'port_not_allowed' };
  return match.security === input.security ? null : { field: 'security', message: 'security_mismatch' };
}
