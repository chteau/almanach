import { randomToken, safeEqual, sha256 } from '../../security/tokens.ts';

/**
 * Holds the one-time installation token in memory (hashed) until installation completes.
 * Proving knowledge of the token, printed in the server logs, stops a stranger from claiming
 * a freshly exposed instance.
 */
export class InstallTokenStore {
  private hash: string | null = null;

  /**
   * Activates a token: the preset one when given, otherwise a new random one
   *
   * @param preset {string | undefined} - token supplied through ALMANACH_INSTALL_TOKEN
   * @returns {string | null} - the generated token to print, or null when a preset is used
   */
  issue(preset?: string): string | null {
    if (preset) {
      this.hash = sha256(preset);
      return null;
    }
    const token = randomToken();
    this.hash = sha256(token);
    return token;
  }

  /**
   * Tells whether a candidate matches the active token
   *
   * @param candidate {string | undefined} - token sent by the client
   * @returns {boolean} - true when a token is active and matches
   */
  verify(candidate: string | undefined): boolean {
    if (!this.hash || !candidate || candidate.length > 256) return false;
    return safeEqual(sha256(candidate), this.hash);
  }

  /**
   * Invalidates the token for good once installation is complete
   *
   * @returns {void} - nothing
   */
  revoke(): void {
    this.hash = null;
  }
}
