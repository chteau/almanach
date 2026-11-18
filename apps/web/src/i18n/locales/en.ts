import { appEn } from './app.en.ts';
import { docsEn } from './docs.en.ts';
import { planEn } from './plan.en.ts';

/** English messages: the reference catalogue every other locale must match. */
export const en = {
  'lang.fr': 'Français',
  'lang.en': 'English',
  'lang.de': 'Deutsch',

  'common.back': 'Back',
  'common.continue': 'Continue',
  'common.loading': 'Loading…',
  'common.retry': 'Retry',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.error.generic': 'Something went wrong. Please try again.',
  'common.error.network': 'The server could not be reached. Check your connection and try again.',
  'common.error.rate_limited': 'Too many attempts. Wait a minute, then try again.',
  'common.error.reference': 'Error reference: {id}',

  'install.title': 'Install Almanach',
  'install.stepOf': 'Step {current} of {total}',
  'install.step.language': 'Language',
  'install.step.token': 'Security',
  'install.step.checks': 'Checks',
  'install.step.admin': 'Administrator',
  'install.step.instance': 'Instance',
  'install.step.summary': 'Summary',

  'install.language.title': 'Welcome to Almanach',
  'install.language.body': 'Choose the language for the installation. Each person can pick their own later.',

  'install.token.title': 'Prove this server is yours',
  'install.token.body':
    'Almanach printed a one-time installation token in the server logs, so nobody else can claim this instance.',
  'install.token.command': 'Display it with this command:',
  'install.token.field': 'Installation token',
  'install.token.invalid':
    'This token does not match. Copy it again from the logs; restarting the server prints a new one.',
  'install.token.used': 'This instance is already installed.',

  'install.checks.title': 'Checking the environment',
  'install.checks.body':
    'Red items block the installation; orange ones deserve attention before going online.',
  'install.checks.blocked': 'Fix the red items, then run the checks again.',
  'install.checks.status.ok': 'OK',
  'install.checks.status.warn': 'Warning',
  'install.checks.status.fail': 'Blocking',
  'install.checks.database.label': 'Database',
  'install.checks.database.ok': 'Connected.',
  'install.checks.database.fail': 'Unreachable. Check DATABASE_URL and the database container logs.',
  'install.checks.migrations.label': 'Database schema',
  'install.checks.migrations.ok': 'Up to date.',
  'install.checks.migrations.fail': 'Migrations did not run. Read the server logs.',
  'install.checks.https.label': 'HTTPS',
  'install.checks.https.ok': 'The connection is encrypted.',
  'install.checks.https.warn':
    'The connection is not encrypted. Put Almanach behind HTTPS before exposing it online.',
  'install.checks.cookies.label': 'Session cookies',
  'install.checks.cookies.ok': 'Correctly configured.',
  'install.checks.cookies.warn': 'Served over HTTPS but COOKIE_SECURE=false. Set it to true.',
  'install.checks.cookies.fail':
    'COOKIE_SECURE=true requires HTTPS, otherwise signing in fails. Enable HTTPS, or set COOKIE_SECURE=false on a trusted local network only.',
  'install.checks.timezone.label': 'Server time zone',
  'install.checks.timezone.ok': '{detail}',

  'install.admin.title': 'Create the administrator account',
  'install.admin.body': 'This account manages the instance and its settings.',
  'install.admin.email': 'E-mail address',
  'install.admin.email.invalid': 'Enter a valid e-mail address.',
  'install.admin.password': 'Password',
  'install.admin.password.hint': 'At least 12 characters. A short sentence works well.',
  'install.admin.password.show': 'Show password',
  'install.admin.password.too_short': 'At least 12 characters.',
  'install.admin.password.too_long': 'At most 128 characters.',
  'install.admin.password.contains_email': 'Must not contain your e-mail address.',
  'install.admin.password.too_simple': 'Use more varied characters.',
  'install.admin.strength': 'Strength: {level}',
  'install.admin.strength.weak': 'weak',
  'install.admin.strength.fair': 'fair',
  'install.admin.strength.strong': 'strong',
  'install.admin.mfa': 'You can turn on two-factor authentication in your settings right after installation.',

  'install.instance.title': 'Name your instance',
  'install.instance.body': 'These settings apply to everyone using this Almanach.',
  'install.instance.name': 'Instance name',
  'install.instance.name.invalid': 'Enter a name of 1 to 80 characters.',
  'install.instance.url': 'Public address',
  'install.instance.url.hint':
    'The address people type to reach Almanach, used in e-mails and calendar links.',
  'install.instance.url.invalid': 'Enter a full address starting with https:// or http://.',
  'install.instance.timezone': 'Default time zone',
  'install.instance.timezone.hint': 'Deadlines and reminders are computed in this time zone.',

  'install.summary.title': 'Ready to install',
  'install.summary.body': 'Check these details. You can change them later in the settings.',
  'install.summary.language': 'Language',
  'install.summary.admin': 'Administrator',
  'install.summary.name': 'Instance name',
  'install.summary.url': 'Public address',
  'install.summary.timezone': 'Time zone',
  'install.summary.submit': 'Install Almanach',
  'install.summary.submitting': 'Installing…',
  'install.summary.error.already_installed': 'This instance was installed in the meantime. Sign in instead.',
  'install.summary.error.checks_failed': 'A blocking check failed. Go back to the checks.',
  'install.summary.error.validation_failed': 'Some information is invalid. Go back and correct it.',

  'login.title': 'Sign in',
  ...appEn,
  ...docsEn,
  ...planEn,
};
