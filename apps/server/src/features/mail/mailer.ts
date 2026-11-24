import type { Locale } from '@almanach/shared';
import { createTransport, type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';
import type { Config } from '../../config.ts';
import type { Database } from '../../db/client.ts';
import { mailSettings } from '../../db/schema.ts';
import { decryptSecret, encryptSecret } from '../../security/secrets.ts';
import {
  type DeviceCode,
  OAuthError,
  pollDeviceCode,
  refreshAccessToken,
  startDeviceCode,
  xoauth2Token,
} from './outlook.ts';
import { checkEndpoint, MAIL_PRESETS, type MailSettingsInput } from './providers.ts';

/** Error codes of a failed test or send, returned to the interface. */
export type MailErrorCode =
  | 'auth_failed'
  | 'connection_failed'
  | 'timeout'
  | 'tls_failed'
  | 'oauth_failed'
  | 'not_configured'
  | 'secrets_key_missing'
  | 'failed';

/** A failed send, with a short server message free of secrets. */
export class MailError extends Error {
  /**
   * Creates the error
   *
   * @param code {MailErrorCode} - error code
   * @param detail {string} - short message without secrets
   */
  constructor(
    readonly code: MailErrorCode,
    readonly detail = '',
  ) {
    super(detail || code);
  }
}

/**
 * This function removes credentials and long tokens from a server message and shortens it
 *
 * @param message {string} - raw message
 * @returns {string} - message safe to show
 */
export function redact(message: string): string {
  return message
    .replace(/\/\/[^\s/@]+@/g, '//***@')
    .replace(/[A-Za-z0-9+/=_-]{40,}/g, '***')
    .slice(0, 200);
}

/**
 * This function maps a nodemailer, network or OAuth error to an error code the interface explains
 *
 * @param error {unknown} - thrown value
 * @returns {MailError} - code and redacted detail
 */
export function mailError(error: unknown): MailError {
  if (error instanceof MailError) return error;
  if (error instanceof OAuthError) return new MailError(error.code, redact(error.detail));
  const raw = (error ?? {}) as { code?: unknown; responseCode?: unknown; message?: unknown };
  const code = typeof raw.code === 'string' ? raw.code : '';
  const message = typeof raw.message === 'string' ? raw.message : String(error);
  const detail = redact(message);
  if (code === 'EAUTH' || raw.responseCode === 535 || raw.responseCode === 534) {
    return new MailError('auth_failed', detail);
  }
  if (code === 'ETLS' || /\b(?:tls|ssl)\b|certificate|wrong version number|EPROTO|handshake/i.test(message)) {
    return new MailError('tls_failed', detail);
  }
  if (code === 'ETIMEDOUT' || /ETIMEDOUT|timeout/i.test(message)) return new MailError('timeout', detail);
  if (
    ['ESOCKET', 'ECONNECTION', 'EDNS'].includes(code) ||
    /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|ECONNRESET/.test(message)
  ) {
    return new MailError('connection_failed', detail);
  }
  return new MailError('failed', detail);
}

/** Stored settings, as the interface sees them: no secret, only whether one is stored. */
export interface MailConfigView {
  provider: string;
  host: string;
  port: number;
  security: 'tls' | 'starttls';
  username: string;
  from: string;
  hasPassword: boolean;
  oauthConnected: boolean;
}

/** Answer of GET /api/settings/mail. */
export interface MailStatus {
  /** Settings in use: the environment (SMTP_URL) wins over the database. */
  source: 'env' | 'db' | 'none';
  /** Host and port of SMTP_URL, without credentials. */
  envHost: string | null;
  outlookAvailable: boolean;
  secretsKey: boolean;
  config: MailConfigView | null;
}

/** Builds a transporter; tests pass a fake. */
export type TransportFactory = (options: string | SMTPTransport.Options) => Pick<Transporter, 'sendMail'>;

type Row = typeof mailSettings.$inferSelect;

interface Pending {
  deviceCode: string;
  username: string;
  from: string;
  expiresAt: number;
  interval: number;
  nextPollAt: number;
}

const DEFAULT_FROM = 'Almanach <almanach@localhost>';

const TEST_TEXT: Record<Locale, { subject: string; text: string }> = {
  fr: {
    subject: 'Almanach : e-mail de test',
    text: 'Cet e-mail confirme que l’envoi des e-mails d’Almanach fonctionne.',
  },
  en: { subject: 'Almanach: test e-mail', text: 'This e-mail confirms that Almanach can send e-mail.' },
  de: {
    subject: 'Almanach: Test-E-Mail',
    text: 'Diese E-Mail bestätigt, dass Almanach E-Mails versenden kann.',
  },
};

/**
 * Sends the instance's e-mail. Settings come from SMTP_URL when set, else from the row saved in the interface;
 * Outlook / Hotmail goes through Microsoft OAuth2 with a device code (docs/email.md).
 */
export class Mailer {
  private row: Promise<Row | null> | null = null;
  private access: { token: string; expiresAt: number } | null = null;
  private readonly pending = new Map<string, Pending>();
  private readonly fetcher: typeof fetch;
  private readonly transport: TransportFactory;
  private readonly now: () => number;

  /**
   * Creates the service; one instance is shared by the reminders and the settings routes
   *
   * @param db {Database} - Drizzle database
   * @param config {Pick<Config, 'smtpUrl' | 'smtpFrom' | 'secretsKey' | 'msOAuthClientId'>} - runtime configuration
   * @param options {{ fetch?: typeof fetch; transport?: TransportFactory; now?: () => number }} - injectable for tests
   */
  constructor(
    private readonly db: Database,
    private readonly config: Pick<Config, 'smtpUrl' | 'smtpFrom' | 'secretsKey' | 'msOAuthClientId'>,
    options: { fetch?: typeof fetch; transport?: TransportFactory; now?: () => number } = {},
  ) {
    this.fetcher = options.fetch ?? fetch;
    this.transport = options.transport ?? createTransport;
    this.now = options.now ?? Date.now;
  }

  /**
   * This method reads the stored settings once, until they change
   *
   * @returns {Promise<Row | null>} - the row, or null
   */
  private load(): Promise<Row | null> {
    this.row ??= this.db
      .select()
      .from(mailSettings)
      .limit(1)
      .then((rows) => rows[0] ?? null)
      .catch((error) => {
        this.row = null;
        throw error;
      });
    return this.row;
  }

  /**
   * This method forgets cached settings and tokens after a change
   *
   * @returns {void} - nothing
   */
  private invalidate(): void {
    this.row = null;
    this.access = null;
  }

  /**
   * This method tells which settings are in use
   *
   * @returns {Promise<'env' | 'db' | 'none'>} - environment first, then database
   */
  async source(): Promise<'env' | 'db' | 'none'> {
    if (this.config.smtpUrl) return 'env';
    return (await this.load()) ? 'db' : 'none';
  }

  /**
   * This method tells whether e-mail can be sent at all
   *
   * @returns {Promise<boolean>} - true when settings exist
   */
  async configured(): Promise<boolean> {
    return (await this.source()) !== 'none';
  }

  /**
   * This method describes the settings for the interface, without secrets
   *
   * @returns {Promise<MailStatus>} - status
   */
  async status(): Promise<MailStatus> {
    const row = await this.load();
    return {
      source: await this.source(),
      envHost: this.config.smtpUrl ? new URL(this.config.smtpUrl).host : null,
      outlookAvailable: Boolean(this.config.msOAuthClientId),
      secretsKey: Boolean(this.config.secretsKey),
      config: row
        ? {
            provider: row.provider,
            host: row.host,
            port: row.port,
            security: row.security,
            username: row.username,
            from: row.fromAddress,
            hasPassword: Boolean(row.passwordEnc),
            oauthConnected: Boolean(row.oauthRefreshEnc),
          }
        : null,
    };
  }

  /**
   * This method sends one plain-text message
   *
   * @param message {{ to: string; subject: string; text: string }} - recipient and content
   * @returns {Promise<void>} - resolves once the server accepted it
   * @throws {MailError} - mapped error
   */
  async send(message: { to: string; subject: string; text: string }): Promise<void> {
    try {
      const { transporter, from } = await this.transporter();
      await transporter.sendMail({ from, ...message });
    } catch (error) {
      const mapped = mailError(error);
      if (mapped.code === 'auth_failed') this.access = null;
      throw mapped;
    }
  }

  /**
   * This method sends a test message
   *
   * @param to {string} - recipient
   * @param locale {Locale} - language of the message
   * @returns {Promise<{ ok: true; to: string } | { error: MailErrorCode; detail?: string }>} - outcome
   */
  async test(
    to: string,
    locale: Locale,
  ): Promise<{ ok: true; to: string } | { error: MailErrorCode; detail?: string }> {
    try {
      await this.send({ to, ...TEST_TEXT[locale] });
      return { ok: true, to };
    } catch (error) {
      const { code, detail } = mailError(error);
      return detail ? { error: code, detail } : { error: code };
    }
  }

  /**
   * This method saves the settings; a password is encrypted, an omitted one keeps the stored one
   *
   * @param input {MailSettingsInput} - validated settings
   * @param userId {string} - administrator
   * @returns {Promise<null | { error: 'port_not_allowed' | 'secrets_key_missing' } | { field: string; message: string }>} - null when saved
   */
  async save(
    input: MailSettingsInput,
    userId: string,
  ): Promise<
    null | { error: 'port_not_allowed' | 'secrets_key_missing' } | { field: string; message: string }
  > {
    const refused = checkEndpoint(input);
    if (refused) return refused;
    const current = await this.load();
    let passwordEnc: string | null = null;
    let oauthRefreshEnc: string | null = null;
    if (input.provider === 'outlook') {
      // The refresh token belongs to one mailbox: another address must connect again.
      if (current?.provider === 'outlook' && current.username === input.username) {
        oauthRefreshEnc = current.oauthRefreshEnc;
      }
    } else if (input.password) {
      if (!this.config.secretsKey) return { error: 'secrets_key_missing' };
      passwordEnc = encryptSecret(input.password, this.config.secretsKey);
    } else {
      passwordEnc = current?.passwordEnc ?? null;
      if (!passwordEnc) return { field: 'password', message: 'required' };
    }
    await this.write({
      provider: input.provider,
      host: input.host,
      port: input.port,
      security: input.security,
      username: input.username,
      fromAddress: input.from,
      passwordEnc,
      oauthRefreshEnc,
      updatedBy: userId,
    });
    return null;
  }

  /**
   * This method removes the stored settings
   *
   * @returns {Promise<void>} - resolves when done
   */
  async remove(): Promise<void> {
    await this.db.delete(mailSettings);
    this.invalidate();
  }

  /**
   * This method starts connecting an Outlook / Hotmail mailbox; the device code stays here, keyed by administrator
   *
   * @param userId {string} - administrator
   * @param mailbox {{ username: string; from: string }} - mailbox address and sender
   * @returns {Promise<Omit<DeviceCode, 'deviceCode'> | { error: 'outlook_unavailable' | 'secrets_key_missing' | 'oauth_failed' }>} - what the person needs
   */
  async outlookStart(
    userId: string,
    mailbox: { username: string; from: string },
  ): Promise<
    Omit<DeviceCode, 'deviceCode'> | { error: 'outlook_unavailable' | 'secrets_key_missing' | 'oauth_failed' }
  > {
    const clientId = this.config.msOAuthClientId;
    if (!clientId) return { error: 'outlook_unavailable' };
    if (!this.config.secretsKey) return { error: 'secrets_key_missing' };
    try {
      const { deviceCode, ...shown } = await startDeviceCode(clientId, this.fetcher);
      const now = this.now();
      this.pending.set(userId, {
        deviceCode,
        ...mailbox,
        expiresAt: now + shown.expiresIn * 1000,
        interval: shown.interval,
        nextPollAt: now,
      });
      return shown;
    } catch (error) {
      console.warn('[mail] Outlook device code refused:', mailError(error).detail);
      return { error: 'oauth_failed' };
    }
  }

  /**
   * This method asks Microsoft whether the administrator finished signing in, at most once per interval; once
   * connected, the encrypted refresh token is saved with the Outlook preset
   *
   * @param userId {string} - administrator
   * @returns {Promise<{ status: 'pending' | 'connected' | 'declined' | 'expired' } | { error: 'oauth_failed' | 'secrets_key_missing' }>} - outcome
   */
  async outlookPoll(
    userId: string,
  ): Promise<
    | { status: 'pending' | 'connected' | 'declined' | 'expired' }
    | { error: 'oauth_failed' | 'secrets_key_missing' }
  > {
    const pending = this.pending.get(userId);
    const now = this.now();
    const clientId = this.config.msOAuthClientId;
    if (!pending || !clientId || pending.expiresAt <= now) {
      this.pending.delete(userId);
      return { status: 'expired' };
    }
    if (now < pending.nextPollAt) return { status: 'pending' };
    pending.nextPollAt = now + pending.interval * 1000;
    const key = this.config.secretsKey;
    if (!key) return { error: 'secrets_key_missing' };
    try {
      const result = await pollDeviceCode(clientId, pending.deviceCode, this.fetcher);
      if (result.status === 'pending') return result;
      this.pending.delete(userId);
      if (result.status !== 'connected') return result;
      if (!result.tokens.refreshToken) throw new OAuthError('oauth_failed', 'no_refresh_token');
      const preset = MAIL_PRESETS.outlook;
      await this.write({
        provider: 'outlook',
        host: preset.host,
        port: preset.ports[0]?.port ?? 587,
        security: 'starttls',
        username: pending.username,
        fromAddress: pending.from,
        passwordEnc: null,
        oauthRefreshEnc: encryptSecret(result.tokens.refreshToken, key),
        updatedBy: userId,
      });
      this.access = { token: result.tokens.accessToken, expiresAt: now + result.tokens.expiresIn * 1000 };
      return { status: 'connected' };
    } catch (error) {
      console.warn('[mail] Outlook sign-in failed:', mailError(error).detail);
      return { error: 'oauth_failed' };
    }
  }

  /**
   * This method writes the single settings row and forgets the cache
   *
   * @param values {Omit<typeof mailSettings.$inferInsert, 'id'>} - columns
   * @returns {Promise<void>} - resolves when written
   */
  private async write(values: Omit<typeof mailSettings.$inferInsert, 'id'>): Promise<void> {
    const row = { ...values, updatedAt: new Date(this.now()) };
    await this.db
      .insert(mailSettings)
      .values({ id: 1, ...row })
      .onConflictDoUpdate({ target: mailSettings.id, set: row });
    this.invalidate();
  }

  /**
   * This method returns a valid Outlook access token, refreshed a minute before it expires; Microsoft rotates the
   * refresh token at each refresh, and the new one is stored encrypted in place of the old one
   *
   * @param row {Row} - Outlook settings
   * @param key {Buffer} - SECRETS_KEY
   * @returns {Promise<string>} - access token
   * @throws {MailError} - oauth_failed when the person must connect again
   */
  private async accessToken(row: Row, key: Buffer): Promise<string> {
    const now = this.now();
    if (this.access && this.access.expiresAt - 60_000 > now) return this.access.token;
    const clientId = this.config.msOAuthClientId;
    if (!clientId) throw new MailError('oauth_failed', 'MS_OAUTH_CLIENT_ID is not set');
    if (!row.oauthRefreshEnc) throw new MailError('oauth_failed', 'not_connected');
    const tokens = await refreshAccessToken(clientId, decryptSecret(row.oauthRefreshEnc, key), this.fetcher);
    if (tokens.refreshToken) {
      await this.db.update(mailSettings).set({ oauthRefreshEnc: encryptSecret(tokens.refreshToken, key) });
      this.row = null;
    }
    this.access = { token: tokens.accessToken, expiresAt: now + tokens.expiresIn * 1000 };
    return tokens.accessToken;
  }

  /**
   * This method builds the transporter of the settings in use
   *
   * @returns {Promise<{ transporter: Pick<Transporter, 'sendMail'>; from: string }>} - transporter and sender
   * @throws {MailError} - not_configured, secrets_key_missing or oauth_failed
   */
  private async transporter(): Promise<{ transporter: Pick<Transporter, 'sendMail'>; from: string }> {
    if (this.config.smtpUrl) {
      return { transporter: this.transport(this.config.smtpUrl), from: this.config.smtpFrom ?? DEFAULT_FROM };
    }
    const row = await this.load();
    if (!row) throw new MailError('not_configured');
    const key = this.config.secretsKey;
    if (!key) throw new MailError('secrets_key_missing');
    const base: SMTPTransport.Options = {
      host: row.host,
      port: row.port,
      secure: row.security === 'tls',
      requireTLS: row.security === 'starttls',
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
      // Proton Mail Bridge listens on loopback only, with its own self-signed certificate.
      ...(row.provider === 'proton_bridge' && { tls: { rejectUnauthorized: false } }),
    };
    if (row.provider === 'outlook') {
      const token = await this.accessToken(row, key);
      const user = row.username;
      return {
        transporter: this.transport({
          ...base,
          auth: { type: 'custom', method: 'XOAUTH2', user, pass: '' },
          customAuth: {
            XOAUTH2: async (ctx) => {
              let reply = await ctx.sendCommand(`AUTH XOAUTH2 ${xoauth2Token(user, token)}`);
              // On failure the server sends a base64 JSON challenge first, answered by an empty line.
              if (reply.status === 334) reply = await ctx.sendCommand('');
              if (reply.status !== 235) throw new Error(`${reply.status} ${reply.text}`);
            },
          },
        }),
        from: row.fromAddress,
      };
    }
    let pass: string;
    try {
      pass = decryptSecret(row.passwordEnc ?? '', key);
    } catch {
      throw new MailError('secrets_key_missing', 'stored password cannot be decrypted with SECRETS_KEY');
    }
    return {
      transporter: this.transport({ ...base, auth: { user: row.username, pass } }),
      from: row.fromAddress,
    };
  }
}
