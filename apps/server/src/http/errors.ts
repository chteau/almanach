import type { ApiErrorBody } from '@almanach/shared';
import type { Context } from 'hono';
import type { ZodError, ZodType, z } from 'zod';

/**
 * Answers 422 with the invalid fields, without echoing submitted values back
 *
 * @param c {Context} - Hono context
 * @param error {ZodError} - validation error
 * @returns {Response} - the JSON response
 */
export function validationError(c: Context, error: ZodError): Response {
  const body: ApiErrorBody = {
    error: 'validation_failed',
    issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  };
  return c.json(body, 422);
}

/**
 * Reads and validates a JSON body; the caller returns the response when validation fails
 *
 * @param c {Context} - Hono context
 * @param schema {ZodType} - strict schema for the body
 * @returns {Promise<{ data: z.output<S> } | { response: Response }>} - parsed data or the 422 response
 */
export async function parseBody<S extends ZodType>(
  c: Context,
  schema: S,
): Promise<{ data: z.output<S>; response?: never } | { response: Response; data?: never }> {
  const body = await c.req.json().catch(() => undefined);
  const parsed = schema.safeParse(body);
  return parsed.success ? { data: parsed.data } : { response: validationError(c, parsed.error) };
}
