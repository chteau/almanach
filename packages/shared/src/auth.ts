import { z } from 'zod';
import { PASSWORD_MAX_LENGTH } from './install.ts';

export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    /** Six-digit authenticator code or a ten-character recovery code, when two-factor sign-in is on. */
    code: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^(\d{6}|[a-z0-9]{10})$/)
      .optional(),
  })
  .strict();

/** Password change from the settings (S-261). */
export const passwordChangeSchema = z
  .object({
    current: z.string().min(1).max(PASSWORD_MAX_LENGTH),
    next: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  })
  .strict();

/** Confirms an authenticator during two-factor setup (S-262). */
export const totpCodeSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/),
  })
  .strict();

/** Turning two-factor sign-in off requires the password again. */
export const totpDisableSchema = z.object({ password: z.string().min(1).max(PASSWORD_MAX_LENGTH) }).strict();

export type LoginRequest = z.input<typeof loginSchema>;

/** The signed-in person, as returned by GET /api/auth/me. */
export interface Me {
  id: string;
  email: string;
  role: 'admin' | 'member';
  locale: string;
  onboarded: boolean;
}
