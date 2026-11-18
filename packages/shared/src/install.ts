import { z } from 'zod';

/** Interface languages shipped with Almanach. */
export const LOCALES = ['fr', 'en', 'de'] as const;
export type Locale = (typeof LOCALES)[number];

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Reasons a password is rejected, shared by the server (enforcement) and the client (feedback). */
export type PasswordIssue = 'too_short' | 'too_long' | 'contains_email' | 'too_simple';

/**
 * Checks whether a string is an IANA time zone known to the runtime
 *
 * @param value {string} - candidate time zone name, e.g. "Europe/Paris"
 * @returns {boolean} - true when the runtime accepts the zone
 */
export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Lists every reason a password does not meet the policy
 *
 * @param password {string} - password to evaluate
 * @param email {string} - account e-mail, whose local part must not appear in the password
 * @returns {PasswordIssue[]} - empty when the password is acceptable
 */
export function passwordIssues(password: string, email: string): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) issues.push('too_short');
  if (password.length > PASSWORD_MAX_LENGTH) issues.push('too_long');
  const localPart = email.split('@')[0]?.toLowerCase() ?? '';
  if (localPart.length >= 3 && password.toLowerCase().includes(localPart)) issues.push('contains_email');
  if (new Set(password).size < 6) issues.push('too_simple');
  return issues;
}

/**
 * Removes trailing slashes so URLs compare and concatenate predictably
 *
 * @param url {string} - absolute URL
 * @returns {string} - the URL without trailing slashes
 */
export function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

export const adminSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const issue of passwordIssues(value.password, value.email)) {
      if (issue === 'too_short' || issue === 'too_long') continue;
      ctx.addIssue({ code: 'custom', path: ['password'], message: issue });
    }
  });

export const instanceSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    publicUrl: z
      .url({ protocol: /^https?$/ })
      .max(2048)
      .transform(normalizeUrl),
    timezone: z.string().max(64).refine(isTimeZone, { message: 'invalid_timezone' }),
  })
  .strict();

export const installRequestSchema = z
  .object({
    locale: z.enum(LOCALES),
    admin: adminSchema,
    instance: instanceSchema,
  })
  .strict();

export type InstallRequest = z.infer<typeof installRequestSchema>;

export type InstallCheckId = 'database' | 'migrations' | 'https' | 'cookies' | 'timezone';
export type InstallCheckStatus = 'ok' | 'warn' | 'fail';

/** One pre-installation check, rendered by the wizard from its id and status. */
export interface InstallCheck {
  id: InstallCheckId;
  status: InstallCheckStatus;
  detail?: string;
}

/** Error body returned by the API; `issues` lists invalid fields for 422 responses. */
export interface ApiErrorBody {
  error: string;
  issues?: { path: string; message: string }[];
  id?: string;
}
