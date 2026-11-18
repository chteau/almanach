import { passwordIssues } from '@almanach/shared';

export type Strength = 'weak' | 'fair' | 'strong';

/**
 * Rates a password for the on-screen meter; the server enforces the actual policy
 *
 * @param password {string} - password being typed
 * @param email {string} - account e-mail, used by the shared policy
 * @returns {Strength} - weak when the policy fails, strong for long passwords mixing character classes
 */
export function passwordStrength(password: string, email: string): Strength {
  if (passwordIssues(password, email).length > 0) return 'weak';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z\d]/].filter((pattern) => pattern.test(password)).length;
  return password.length >= 16 || (password.length >= 12 && classes >= 3) ? 'strong' : 'fair';
}
