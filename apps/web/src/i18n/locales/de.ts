import type { Messages } from '../messages.ts';
import { appDe } from './app.de.ts';
import { docsDe } from './docs.de.ts';
import { planDe } from './plan.de.ts';

/** Deutsche Texte. */
export const de: Messages = {
  'lang.fr': 'Français',
  'lang.en': 'English',
  'lang.de': 'Deutsch',

  'common.back': 'Zurück',
  'common.continue': 'Weiter',
  'common.loading': 'Wird geladen…',
  'common.retry': 'Erneut versuchen',
  'common.copy': 'Kopieren',
  'common.copied': 'Kopiert',
  'common.error.generic': 'Etwas ist schiefgelaufen. Bitte versuchen Sie es erneut.',
  'common.error.network':
    'Der Server ist nicht erreichbar. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
  'common.error.rate_limited': 'Zu viele Versuche. Warten Sie eine Minute und versuchen Sie es dann erneut.',
  'common.error.reference': 'Fehlerreferenz: {id}',

  'install.title': 'Almanach installieren',
  'install.stepOf': 'Schritt {current} von {total}',
  'install.step.language': 'Sprache',
  'install.step.token': 'Sicherheit',
  'install.step.checks': 'Prüfungen',
  'install.step.admin': 'Administrator',
  'install.step.instance': 'Instanz',
  'install.step.summary': 'Zusammenfassung',

  'install.language.title': 'Willkommen bei Almanach',
  'install.language.body':
    'Wählen Sie die Sprache der Installation. Jede Person kann später ihre eigene Sprache wählen.',

  'install.token.title': 'Bestätigen Sie, dass dieser Server Ihnen gehört',
  'install.token.body':
    'Almanach hat ein einmaliges Installationstoken in die Serverprotokolle geschrieben, damit niemand sonst diese Instanz übernehmen kann.',
  'install.token.command': 'Zeigen Sie es mit diesem Befehl an:',
  'install.token.field': 'Installationstoken',
  'install.token.invalid':
    'Dieses Token stimmt nicht. Kopieren Sie es erneut aus den Protokollen; ein Neustart des Servers erzeugt ein neues.',
  'install.token.used': 'Diese Instanz ist bereits installiert.',

  'install.checks.title': 'Umgebung wird geprüft',
  'install.checks.body':
    'Rote Punkte blockieren die Installation; orange Punkte sollten Sie vor der Veröffentlichung beachten.',
  'install.checks.blocked': 'Beheben Sie die roten Punkte und starten Sie die Prüfungen erneut.',
  'install.checks.status.ok': 'OK',
  'install.checks.status.warn': 'Achtung',
  'install.checks.status.fail': 'Blockierend',
  'install.checks.database.label': 'Datenbank',
  'install.checks.database.ok': 'Verbunden.',
  'install.checks.database.fail':
    'Nicht erreichbar. Prüfen Sie DATABASE_URL und die Protokolle des Datenbank-Containers.',
  'install.checks.migrations.label': 'Datenbankschema',
  'install.checks.migrations.ok': 'Aktuell.',
  'install.checks.migrations.fail':
    'Die Migrationen wurden nicht ausgeführt. Lesen Sie die Serverprotokolle.',
  'install.checks.https.label': 'HTTPS',
  'install.checks.https.ok': 'Die Verbindung ist verschlüsselt.',
  'install.checks.https.warn':
    'Die Verbindung ist nicht verschlüsselt. Betreiben Sie Almanach hinter HTTPS, bevor Sie es im Internet erreichbar machen.',
  'install.checks.cookies.label': 'Sitzungscookies',
  'install.checks.cookies.ok': 'Korrekt konfiguriert.',
  'install.checks.cookies.warn':
    'Über HTTPS ausgeliefert, aber COOKIE_SECURE=false. Setzen Sie den Wert auf true.',
  'install.checks.cookies.fail':
    'COOKIE_SECURE=true erfordert HTTPS, sonst schlägt die Anmeldung fehl. Aktivieren Sie HTTPS oder setzen Sie COOKIE_SECURE=false nur in einem vertrauenswürdigen lokalen Netzwerk.',
  'install.checks.timezone.label': 'Zeitzone des Servers',
  'install.checks.timezone.ok': '{detail}',

  'install.admin.title': 'Administratorkonto anlegen',
  'install.admin.body': 'Dieses Konto verwaltet die Instanz und ihre Einstellungen.',
  'install.admin.email': 'E-Mail-Adresse',
  'install.admin.email.invalid': 'Geben Sie eine gültige E-Mail-Adresse ein.',
  'install.admin.password': 'Passwort',
  'install.admin.password.hint': 'Mindestens 12 Zeichen. Ein kurzer Satz eignet sich gut.',
  'install.admin.password.show': 'Passwort anzeigen',
  'install.admin.password.too_short': 'Mindestens 12 Zeichen.',
  'install.admin.password.too_long': 'Höchstens 128 Zeichen.',
  'install.admin.password.contains_email': 'Darf Ihre E-Mail-Adresse nicht enthalten.',
  'install.admin.password.too_simple': 'Verwenden Sie abwechslungsreichere Zeichen.',
  'install.admin.strength': 'Stärke: {level}',
  'install.admin.strength.weak': 'schwach',
  'install.admin.strength.fair': 'mittel',
  'install.admin.strength.strong': 'stark',
  'install.admin.mfa':
    'Die Zwei-Faktor-Authentifizierung können Sie direkt nach der Installation in Ihren Einstellungen aktivieren.',

  'install.instance.title': 'Benennen Sie Ihre Instanz',
  'install.instance.body': 'Diese Einstellungen gelten für alle, die dieses Almanach nutzen.',
  'install.instance.name': 'Name der Instanz',
  'install.instance.name.invalid': 'Geben Sie einen Namen mit 1 bis 80 Zeichen ein.',
  'install.instance.url': 'Öffentliche Adresse',
  'install.instance.url.hint':
    'Die Adresse, unter der Almanach erreichbar ist; sie wird in E-Mails und Kalenderlinks verwendet.',
  'install.instance.url.invalid':
    'Geben Sie eine vollständige Adresse ein, die mit https:// oder http:// beginnt.',
  'install.instance.timezone': 'Standardzeitzone',
  'install.instance.timezone.hint': 'Fristen und Erinnerungen werden in dieser Zeitzone berechnet.',

  'install.summary.title': 'Bereit zur Installation',
  'install.summary.body': 'Prüfen Sie diese Angaben. Sie können sie später in den Einstellungen ändern.',
  'install.summary.language': 'Sprache',
  'install.summary.admin': 'Administrator',
  'install.summary.name': 'Name der Instanz',
  'install.summary.url': 'Öffentliche Adresse',
  'install.summary.timezone': 'Zeitzone',
  'install.summary.submit': 'Almanach installieren',
  'install.summary.submitting': 'Wird installiert…',
  'install.summary.error.already_installed':
    'Diese Instanz wurde inzwischen installiert. Melden Sie sich stattdessen an.',
  'install.summary.error.checks_failed':
    'Eine blockierende Prüfung ist fehlgeschlagen. Gehen Sie zurück zu den Prüfungen.',
  'install.summary.error.validation_failed':
    'Einige Angaben sind ungültig. Gehen Sie zurück und korrigieren Sie sie.',

  'login.title': 'Anmelden',
  ...appDe,
  ...docsDe,
  ...planDe,
};
