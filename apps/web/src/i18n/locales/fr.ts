import type { Messages } from '../messages.ts';
import { appFr } from './app.fr.ts';
import { componentsFr } from './components.fr.ts';
import { docsFr } from './docs.fr.ts';
import { planFr } from './plan.fr.ts';

/** Messages en français. */
export const fr: Messages = {
  'lang.fr': 'Français',
  'lang.en': 'English',
  'lang.de': 'Deutsch',

  'common.back': 'Retour',
  'common.continue': 'Continuer',
  'common.loading': 'Chargement…',
  'common.retry': 'Réessayer',
  'common.copy': 'Copier',
  'common.copied': 'Copié',
  'common.error.generic': 'Une erreur est survenue. Réessayez.',
  'common.error.network': 'Le serveur est injoignable. Vérifiez votre connexion et réessayez.',
  'common.error.rate_limited': 'Trop de tentatives. Patientez une minute, puis réessayez.',
  'common.error.reference': 'Référence de l’erreur : {id}',

  'install.title': 'Installer Almanach',
  'install.stepOf': 'Étape {current} sur {total}',
  'install.step.language': 'Langue',
  'install.step.token': 'Sécurité',
  'install.step.checks': 'Vérifications',
  'install.step.admin': 'Administrateur',
  'install.step.instance': 'Instance',
  'install.step.summary': 'Récapitulatif',

  'install.language.title': 'Bienvenue dans Almanach',
  'install.language.body':
    'Choisissez la langue de l’installation. Chaque personne pourra choisir la sienne ensuite.',

  'install.token.title': 'Prouvez que ce serveur est le vôtre',
  'install.token.body':
    'Almanach a affiché un jeton d’installation à usage unique dans les logs du serveur, pour que personne d’autre ne puisse s’approprier cette instance.',
  'install.token.command': 'Affichez-le avec cette commande :',
  'install.token.field': 'Jeton d’installation',
  'install.token.invalid':
    'Ce jeton ne correspond pas. Recopiez-le depuis les logs ; un redémarrage du serveur en affiche un nouveau.',
  'install.token.used': 'Cette instance est déjà installée.',

  'install.checks.title': 'Vérification de l’environnement',
  'install.checks.body':
    'Les points rouges bloquent l’installation ; les points orange méritent votre attention avant une mise en ligne.',
  'install.checks.blocked': 'Corrigez les points rouges, puis relancez les vérifications.',
  'install.checks.status.ok': 'OK',
  'install.checks.status.warn': 'Attention',
  'install.checks.status.fail': 'Bloquant',
  'install.checks.database.label': 'Base de données',
  'install.checks.database.ok': 'Connectée.',
  'install.checks.database.fail': 'Injoignable. Vérifiez DATABASE_URL et les logs du conteneur de la base.',
  'install.checks.migrations.label': 'Schéma de la base',
  'install.checks.migrations.ok': 'À jour.',
  'install.checks.migrations.fail': 'Les migrations n’ont pas été appliquées. Consultez les logs du serveur.',
  'install.checks.https.label': 'HTTPS',
  'install.checks.https.ok': 'La connexion est chiffrée.',
  'install.checks.https.warn':
    'La connexion n’est pas chiffrée. Placez Almanach derrière HTTPS avant de l’exposer sur Internet.',
  'install.checks.cookies.label': 'Cookies de session',
  'install.checks.cookies.ok': 'Correctement configurés.',
  'install.checks.cookies.warn': 'Servi en HTTPS mais COOKIE_SECURE=false. Passez-le à true.',
  'install.checks.cookies.fail':
    'COOKIE_SECURE=true exige HTTPS, sinon la connexion échoue. Activez HTTPS, ou mettez COOKIE_SECURE=false uniquement sur un réseau local de confiance.',
  'install.checks.timezone.label': 'Fuseau horaire du serveur',
  'install.checks.timezone.ok': '{detail}',

  'install.admin.title': 'Créez le compte administrateur',
  'install.admin.body': 'Ce compte gère l’instance et ses paramètres.',
  'install.admin.email': 'Adresse e-mail',
  'install.admin.email.invalid': 'Saisissez une adresse e-mail valide.',
  'install.admin.password': 'Mot de passe',
  'install.admin.password.hint': 'Au moins 12 caractères. Une courte phrase fonctionne très bien.',
  'install.admin.password.show': 'Afficher le mot de passe',
  'install.admin.password.too_short': 'Au moins 12 caractères.',
  'install.admin.password.too_long': '128 caractères au maximum.',
  'install.admin.password.contains_email': 'Ne doit pas contenir votre adresse e-mail.',
  'install.admin.password.too_simple': 'Utilisez des caractères plus variés.',
  'install.admin.strength': 'Robustesse : {level}',
  'install.admin.strength.weak': 'faible',
  'install.admin.strength.fair': 'moyenne',
  'install.admin.strength.strong': 'bonne',
  'install.admin.mfa':
    'Vous pourrez activer la double authentification dans vos paramètres juste après l’installation.',

  'install.instance.title': 'Nommez votre instance',
  'install.instance.body': 'Ces réglages s’appliquent à toutes les personnes qui utilisent cet Almanach.',
  'install.instance.name': 'Nom de l’instance',
  'install.instance.name.invalid': 'Saisissez un nom de 1 à 80 caractères.',
  'install.instance.url': 'Adresse publique',
  'install.instance.url.hint':
    'L’adresse à taper pour accéder à Almanach, utilisée dans les e-mails et les liens d’agenda.',
  'install.instance.url.invalid': 'Saisissez une adresse complète commençant par https:// ou http://.',
  'install.instance.timezone': 'Fuseau horaire par défaut',
  'install.instance.timezone.hint': 'Les échéances et les rappels sont calculés dans ce fuseau.',

  'install.summary.title': 'Prêt pour l’installation',
  'install.summary.body':
    'Vérifiez ces informations. Vous pourrez les modifier plus tard dans les paramètres.',
  'install.summary.language': 'Langue',
  'install.summary.admin': 'Administrateur',
  'install.summary.name': 'Nom de l’instance',
  'install.summary.url': 'Adresse publique',
  'install.summary.timezone': 'Fuseau horaire',
  'install.summary.submit': 'Installer Almanach',
  'install.summary.submitting': 'Installation…',
  'install.summary.error.already_installed':
    'Cette instance a été installée entre-temps. Connectez-vous plutôt.',
  'install.summary.error.checks_failed': 'Une vérification bloquante a échoué. Revenez aux vérifications.',
  'install.summary.error.validation_failed':
    'Certaines informations sont invalides. Revenez en arrière pour les corriger.',

  'login.title': 'Connexion',
  ...appFr,
  ...componentsFr,
  ...docsFr,
  ...planFr,
};
