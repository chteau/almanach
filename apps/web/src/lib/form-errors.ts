import type { ApiErrorBody } from '@almanach/shared';
import type { ZodError } from 'zod';
import type { MessageKey } from '../i18n/messages.ts';

/** Validation messages the interface knows how to explain; anything else falls back to errors.invalid. */
const KNOWN = new Set([
  'invalid_iban',
  'invalid_bic',
  'invalid_sort_code',
  'invalid_account',
  'invalid_routing',
  'invalid_vat',
  'invalid_format',
  'required',
  'end_before_start',
  'one_billing_contact',
  'unknown_status',
  'unknown_period',
]);

/**
 * Maps validation issues (from Zod in the browser or a 422 from the server) to one message key per field
 *
 * @param issues {{ path: string; message: string }[]} - issues with dotted paths
 * @returns {Record<string, MessageKey>} - first message key per field path
 */
export function fieldErrors(issues: { path: string; message: string }[]): Record<string, MessageKey> {
  const errors: Record<string, MessageKey> = {};
  for (const issue of issues) {
    errors[issue.path] ??= (
      KNOWN.has(issue.message) ? `errors.${issue.message}` : 'errors.invalid'
    ) as MessageKey;
  }
  return errors;
}

/**
 * Flattens a ZodError into dotted-path issues
 *
 * @param error {ZodError} - validation error
 * @returns {{ path: string; message: string }[]} - issues
 */
export function zodIssues(error: ZodError): { path: string; message: string }[] {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

/**
 * Extracts issues from a server 422 body
 *
 * @param body {ApiErrorBody} - error body
 * @returns {{ path: string; message: string }[]} - issues, empty when none
 */
export function serverIssues(body: ApiErrorBody): { path: string; message: string }[] {
  return body.issues ?? [];
}
