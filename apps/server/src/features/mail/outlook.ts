import { z } from 'zod';

/** Microsoft identity platform, personal accounts tenant (Outlook.com, Hotmail, Live). */
export const MS_AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
/** SMTP sending on Outlook.com, plus a refresh token to keep sending without the person (docs/email.md). */
export const MS_SCOPE = 'https://outlook.office.com/SMTP.Send offline_access';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

/** Thrown when Microsoft refuses or cannot be reached; the code is the API error returned to the interface. */
export class OAuthError extends Error {
  /**
   * Creates the error
   *
   * @param code {'oauth_failed' | 'connection_failed'} - error code
   * @param detail {string} - short message, without any token
   */
  constructor(
    readonly code: 'oauth_failed' | 'connection_failed',
    readonly detail: string,
  ) {
    super(detail);
  }
}

const deviceCodeSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1).max(64),
  verification_uri: z.url({ protocol: /^https$/ }),
  expires_in: z.number().int().positive(),
  interval: z.number().int().positive().default(5),
  message: z.string().max(1000).default(''),
});

const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.coerce.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
});

const errorSchema = z.object({ error: z.string(), error_description: z.string().optional() });

/** Pending device authorization, kept on the server: the device code never reaches the browser. */
export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
  message: string;
}

/** Tokens returned by Microsoft. */
export interface Tokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string | undefined;
}

/**
 * This function builds the SASL XOAUTH2 initial response Outlook expects after `AUTH XOAUTH2`
 *
 * @param user {string} - mailbox address
 * @param accessToken {string} - OAuth2 access token
 * @returns {string} - base64 of `user=<user>^Aauth=Bearer <token>^A^A`
 */
export function xoauth2Token(user: string, accessToken: string): string {
  return Buffer.from(`user=${user}\x01auth=Bearer ${accessToken}\x01\x01`).toString('base64');
}

/**
 * This function posts a form to a Microsoft endpoint and returns the status and JSON body
 *
 * @param fetcher {typeof fetch} - HTTP client
 * @param path {string} - `/devicecode` or `/token`
 * @param form {Record<string, string>} - form fields
 * @returns {Promise<{ status: number; body: unknown }>} - response
 * @throws {OAuthError} - connection_failed when Microsoft cannot be reached
 */
async function post(
  fetcher: typeof fetch,
  path: string,
  form: Record<string, string>,
): Promise<{ status: number; body: unknown }> {
  try {
    const response = await fetcher(`${MS_AUTHORITY}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch (error) {
    throw new OAuthError('connection_failed', error instanceof Error ? error.message.slice(0, 200) : 'fetch');
  }
}

/**
 * This function reads the OAuth error code of a refused request
 *
 * @param body {unknown} - JSON body
 * @returns {string} - `error` field, or `unknown`
 */
function errorCode(body: unknown): string {
  const parsed = errorSchema.safeParse(body);
  return parsed.success ? parsed.data.error : 'unknown';
}

/**
 * This function parses a token response
 *
 * @param body {unknown} - JSON body
 * @returns {Tokens} - tokens
 * @throws {OAuthError} - oauth_failed when the body is not a token response
 */
function tokens(body: unknown): Tokens {
  const parsed = tokenSchema.safeParse(body);
  if (!parsed.success) throw new OAuthError('oauth_failed', 'invalid_token_response');
  return {
    accessToken: parsed.data.access_token,
    expiresIn: parsed.data.expires_in,
    refreshToken: parsed.data.refresh_token,
  };
}

/**
 * This function starts the device code flow: Microsoft returns a code the person types at its verification page
 *
 * @param clientId {string} - public client ID (MS_OAUTH_CLIENT_ID)
 * @param fetcher {typeof fetch} - HTTP client
 * @returns {Promise<DeviceCode>} - the pending authorization
 * @throws {OAuthError} - when Microsoft refuses or cannot be reached
 */
export async function startDeviceCode(clientId: string, fetcher: typeof fetch): Promise<DeviceCode> {
  const { status, body } = await post(fetcher, '/devicecode', { client_id: clientId, scope: MS_SCOPE });
  const parsed = deviceCodeSchema.safeParse(body);
  if (status !== 200 || !parsed.success) throw new OAuthError('oauth_failed', errorCode(body));
  return {
    deviceCode: parsed.data.device_code,
    userCode: parsed.data.user_code,
    verificationUri: parsed.data.verification_uri,
    expiresIn: parsed.data.expires_in,
    interval: parsed.data.interval,
    message: parsed.data.message,
  };
}

/**
 * This function asks Microsoft once whether the person finished signing in
 *
 * @param clientId {string} - public client ID
 * @param deviceCode {string} - device code from startDeviceCode
 * @param fetcher {typeof fetch} - HTTP client
 * @returns {Promise<{ status: 'pending' | 'declined' | 'expired' } | { status: 'connected'; tokens: Tokens }>} - outcome
 * @throws {OAuthError} - on any other refusal, or when Microsoft cannot be reached
 */
export async function pollDeviceCode(
  clientId: string,
  deviceCode: string,
  fetcher: typeof fetch,
): Promise<{ status: 'pending' | 'declined' | 'expired' } | { status: 'connected'; tokens: Tokens }> {
  const { status, body } = await post(fetcher, '/token', {
    grant_type: DEVICE_GRANT,
    client_id: clientId,
    device_code: deviceCode,
  });
  if (status === 200) return { status: 'connected', tokens: tokens(body) };
  const code = errorCode(body);
  if (code === 'authorization_pending' || code === 'slow_down') return { status: 'pending' };
  if (code === 'authorization_declined') return { status: 'declined' };
  if (code === 'expired_token' || code === 'bad_verification_code') return { status: 'expired' };
  throw new OAuthError('oauth_failed', code);
}

/**
 * This function trades a refresh token for a new access token; public clients send no client secret, and
 * Microsoft answers with a rotated refresh token that replaces the old one
 *
 * @param clientId {string} - public client ID
 * @param refreshToken {string} - current refresh token
 * @param fetcher {typeof fetch} - HTTP client
 * @returns {Promise<Tokens>} - new tokens
 * @throws {OAuthError} - oauth_failed when the refresh token is refused (the person must connect again)
 */
export async function refreshAccessToken(
  clientId: string,
  refreshToken: string,
  fetcher: typeof fetch,
): Promise<Tokens> {
  const { status, body } = await post(fetcher, '/token', {
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: refreshToken,
    scope: MS_SCOPE,
  });
  if (status !== 200) throw new OAuthError('oauth_failed', errorCode(body));
  return tokens(body);
}
