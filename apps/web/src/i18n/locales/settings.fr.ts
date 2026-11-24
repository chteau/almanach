import type { settingsEn } from './settings.en.ts';

/** Messages des réglages, en français. */
export const settingsFr: Record<keyof typeof settingsEn, string> = {
  'settings.nav': 'Sections des réglages',
  'settings.group.activity': 'Activité',
  'settings.group.billing': 'Facturation',
  'settings.group.connections': 'Connexions',
  'settings.group.notifications': 'Notifications',
  'settings.group.account': 'Compte et sécurité',
  'settings.group.data': 'Données',
  'settings.group.admin': 'Administration',
  'settings.panel.profile': 'Profil et situation',
  'settings.panel.companies': 'Entreprises et activités',
  'settings.panel.rules': 'Règles du pays',
  'settings.panel.numbering': 'Numérotation',
  'settings.panel.pdf': 'Apparence PDF',
  'settings.panel.defaults': 'Valeurs par défaut',
  'settings.panel.stripe': 'Stripe',
  'settings.panel.linked': 'Instances liées',
  'settings.panel.sources': 'Sources externes',
  'settings.panel.assistants': 'Assistants IA',
  'settings.panel.reminders': 'Rappels',
  'settings.panel.calendar': 'Abonnement agenda',
  'settings.panel.email': 'Envoi des e-mails',
  'settings.panel.password': 'Mot de passe',
  'settings.panel.two-factor': 'Connexion en deux étapes',
  'settings.panel.devices': 'Appareils',
  'settings.panel.data': 'Export et import',
  'settings.panel.instance': 'Instance et autorisations',
  'settings.panel.packs': 'Packs et mises à jour',
  'settings.form.invalid': 'Certains champs sont à corriger.',
  'settings.profile.title': "Coordonnées de l'entreprise",
  'settings.profile.body': 'Elles figurent sur vos devis et factures.',
  'settings.profile.figures': 'Début et devise',
  'settings.profile.saved': 'Profil enregistré.',
  'settings.situation.body':
    'Votre statut et votre pays déterminent les échéances et les seuils. Chaque changement est daté pour que les périodes passées restent justes.',
  'settings.situation.history': 'Historique',
  'settings.situation.cease.consequence':
    'Les échéances s’arrêtent après votre dernier jour et le compte passe en lecture seule. Vous pourrez l’annuler.',
  'settings.situation.cease.action': 'Déclarer',
  'settings.situation.cease.next': 'Choisir le dernier jour',
  'settings.rules.none': 'Aucune règle de pays',
  'settings.rules.none.body':
    'Votre profil est en mode générique : aucune échéance ni aucun seuil n’est calculé. Choisissez un pays via « Changer de statut ou de pays ».',
  'settings.billing.numbering.body': 'La façon dont vos devis, factures et avoirs sont numérotés.',
  'settings.billing.pdf.body': 'Couleur, mise en page et police des PDF que vous envoyez.',
  'settings.billing.logo': 'Logo',
  'settings.billing.logo.removeBody':
    'Le logo disparaît des nouveaux PDF. Les documents déjà envoyés ne changent pas.',
  'settings.billing.logo.removed': 'Logo retiré.',
  'settings.on': 'Activée',
  'settings.off': 'Désactivée',
  'settings.remove': 'Retirer',
  'settings.stripe.synced.zero': 'Aucune nouvelle recette.',
  'settings.stripe.synced.one': '1 nouvelle recette importée.',
  'settings.stripe.synced.many': '{count} nouvelles recettes importées.',
  'settings.stripe.imported.zero': 'Aucune recette importée pour l’instant.',
  'settings.stripe.imported.one': '1 recette importée.',
  'settings.stripe.imported.many': '{count} recettes importées.',
  'settings.stripe.lastSync': 'Dernière synchronisation : {date}.',
  'settings.stripe.remove.consequence':
    'La synchronisation s’arrête et la clé est effacée du serveur. Les recettes déjà importées restent.',
  'settings.technical': 'Détails techniques',
  'settings.tokens.created': 'Jeton créé.',
  'settings.tokens.revoked': '« {name} » révoqué.',
  'settings.tokens.revoke.body':
    'Les assistants qui utilisent « {name} » perdent l’accès immédiatement. C’est définitif.',
  'settings.tokens.empty': 'Aucun jeton pour l’instant',
  'settings.tokens.empty.body': 'Créez-en un par assistant connecté, pour pouvoir le révoquer séparément.',
  'settings.tokens.name.hint':
    'L’assistant ou l’ordinateur qui l’utilisera, par exemple « Assistant du portable ».',
  'settings.tokens.technical':
    'Les assistants se connectent à {url} avec le protocole MCP (Model Context Protocol), en envoyant le jeton dans « Authorization: Bearer … ». La mise en place est décrite dans docs/mcp.md.',
  'settings.totp.enabled': 'La connexion en deux étapes est activée.',
  'settings.totp.disabled': 'La connexion en deux étapes est désactivée.',
  'settings.totp.disable.hint': 'Nécessaire pour désactiver la connexion en deux étapes.',
  'settings.sessions.body': 'Navigateurs et applications actuellement connectés à votre compte.',
  'settings.sessions.signOut': 'Déconnecter',
  'settings.sessions.revoke.body': '{device} devra se reconnecter.',
  'settings.sessions.signedOut': '{device} déconnecté.',
  'settings.sessions.othersSignedOut': 'Tous les autres appareils sont déconnectés.',
  'settings.sessions.revokeOthers.one': 'L’autre appareil devra se reconnecter. Celui-ci reste connecté.',
  'settings.sessions.revokeOthers.many':
    '{count} autres appareils devront se reconnecter. Celui-ci reste connecté.',
  'settings.reminders.body': 'Quand et comment Almanach vous prévient des échéances à venir.',
  'settings.reminders.email.hint': 'Envoyés à votre adresse de connexion, via le serveur réglé dans',
  'settings.ical.none': 'Aucun lien pour l’instant.',
  'settings.ical.revoked': 'Lien révoqué. Les agendas qui l’utilisent ne se mettent plus à jour.',
  'settings.ical.revoke.consequence': 'Les agendas abonnés avec ce lien ne reçoivent plus vos échéances.',
  'settings.ical.revoke.action': 'Révoquer',
  'settings.ical.regenerate.body':
    'Le lien actuel cessera de fonctionner : les agendas abonnés devront être reconfigurés avec le nouveau.',
  'settings.activities.remove.body':
    'Les enregistrements rattachés à cette activité reviennent à l’activité principale.',
  'settings.federation.label': 'Les instances liées voient cette activité sous le nom « {label} ».',
  'settings.federation.optionSaved': 'Liaison mise à jour.',
  'settings.federation.revoked': 'Liaison révoquée.',
  'settings.external.received.zero': 'Aucun nouveau document.',
  'settings.external.received.one': '1 document reçu.',
  'settings.external.received.many': '{count} documents reçus.',
  'settings.external.documents.zero': 'Aucun document pour l’instant.',
  'settings.external.documents.one': '1 document.',
  'settings.external.documents.many': '{count} documents.',
  'settings.external.saved': 'Source enregistrée.',
  'settings.external.removed': 'Source retirée.',
  'settings.external.empty': 'Aucune source externe',
  'settings.external.empty.body':
    'Ajoutez-en une pour afficher à côté des vôtres les devis et factures d’un autre outil.',
  'settings.external.technical':
    'L’autre outil doit publier un flux HTTPS au format almanach-feed/1, protégé par un jeton Bearer. Le format est décrit dans docs/external-sources.md.',
  'settings.packs.body':
    'Les règles livrées avec Almanach pour chaque pays, et les mises à jour signées installées depuis.',
  'settings.packs.new': 'Nouvelle',
  'settings.packs.updates': 'Mises à jour des règles',
  'settings.packs.revert.body':
    'Les règles livrées avec Almanach s’appliquent de nouveau pour ce pays. Vous pourrez réappliquer la mise à jour depuis l’historique.',
  'settings.packs.technical':
    'Les mises à jour sont vérifiées avec les clés de signature listées dans PACK_PUBLIC_KEYS ; la recherche automatique utilise PACK_UPDATE_URL. Les deux se règlent dans la configuration du serveur.',
  'settings.mail.status': 'Comment les e-mails partent',
  'settings.mail.body':
    'Almanach envoie par e-mail les rappels et les messages de test. Le réglage vaut pour toute l’instance.',
  'settings.mail.on': 'Prêt',
  'settings.mail.off': 'Non réglé',
  'settings.mail.env':
    'La configuration du serveur envoie les e-mails via {host}. Elle prime sur les réglages ci-dessous.',
  'settings.mail.db': 'Les e-mails partent avec {provider}, depuis {from}.',
  'settings.mail.none':
    'Aucun e-mail ne part pour l’instant : les rappels restent dans l’application et en notification push.',
  'settings.mail.adminOnly': 'Seul un administrateur peut modifier ce réglage.',
  'settings.mail.account': 'Boîte d’envoi',
  'settings.mail.account.body': 'Choisissez votre fournisseur : son serveur est rempli pour vous.',
  'settings.mail.account.env': 'Utilisée seulement si la configuration du serveur est retirée.',
  'settings.mail.noSecretsKey':
    'Pour enregistrer un mot de passe de messagerie, l’administrateur du serveur doit d’abord définir une clé de chiffrement (SECRETS_KEY dans la configuration du serveur).',
  'settings.mail.provider': 'Fournisseur',
  'settings.mail.provider.gmail': 'Gmail',
  'settings.mail.provider.outlook': 'Outlook / Hotmail',
  'settings.mail.provider.icloud': 'iCloud Mail',
  'settings.mail.provider.yahoo': 'Yahoo Mail',
  'settings.mail.provider.fastmail': 'Fastmail',
  'settings.mail.provider.ovh': 'OVHcloud',
  'settings.mail.provider.infomaniak': 'Infomaniak',
  'settings.mail.provider.proton_bridge': 'Proton Mail (Bridge)',
  'settings.mail.provider.proton_token': 'Proton Mail (jeton SMTP)',
  'settings.mail.provider.other': 'Autre (SMTP)',
  'settings.mail.username': 'Adresse e-mail ou identifiant',
  'settings.mail.from': 'Expéditeur affiché',
  'settings.mail.from.hint':
    'Par exemple « Marie Dupont <marie@example.com> ». Par défaut, l’adresse ci-dessus.',
  'settings.mail.password': 'Mot de passe',
  'settings.mail.appPassword': 'Mot de passe d’application',
  'settings.mail.smtpToken': 'Jeton SMTP',
  'settings.mail.password.hint': 'Stocké chiffré, jamais réaffiché.',
  'settings.mail.password.saved':
    'Un mot de passe est enregistré. N’en saisissez un nouveau que pour le remplacer.',
  'settings.mail.host': 'Serveur',
  'settings.mail.port': 'Port',
  'settings.mail.port.tls': '{port} (TLS)',
  'settings.mail.port.starttls': '{port} (STARTTLS)',
  'settings.mail.port.hint':
    'Seuls les ports 465 et 587 sont utilisés : le port 25, bloqué par la plupart des réseaux, n’est jamais proposé.',
  'settings.mail.saved': 'Réglage enregistré. Envoyez un e-mail de test pour le vérifier.',
  'settings.mail.test': 'Envoyer un e-mail de test',
  'settings.mail.test.sent':
    'E-mail de test envoyé à {to}. Vérifiez votre boîte de réception (et les indésirables).',
  'settings.mail.detail': 'Message du serveur : {detail}',
  'settings.mail.error.auth_failed':
    'Le serveur de messagerie a refusé la connexion : vérifiez l’adresse et le mot de passe (un mot de passe d’application pour Gmail, iCloud ou Yahoo).',
  'settings.mail.error.connection_failed':
    'Le serveur de messagerie est injoignable. Vérifiez son nom, ou que Proton Mail Bridge est lancé.',
  'settings.mail.error.timeout':
    'Le serveur de messagerie n’a pas répondu à temps : le port est sans doute bloqué par le réseau ou l’hébergeur. Essayez l’autre port.',
  'settings.mail.error.tls_failed':
    'La connexion sécurisée a échoué : le port et le chiffrement ne correspondent pas, ou le certificat n’est pas valide.',
  'settings.mail.error.oauth_failed': 'Microsoft a refusé l’accès. Reconnectez la boîte Outlook.',
  'settings.mail.error.not_configured': 'Enregistrez d’abord une boîte d’envoi.',
  'settings.mail.error.secrets_key_missing':
    'Le serveur n’a pas de clé de chiffrement (SECRETS_KEY) : aucun mot de passe ne peut être enregistré.',
  'settings.mail.error.port_not_allowed':
    'Ce port n’est pas autorisé. Utilisez 465 ou 587 ; le port 25 n’est jamais utilisé.',
  'settings.mail.error.outlook_unavailable':
    'La connexion Outlook n’est pas configurée sur ce serveur (MS_OAUTH_CLIENT_ID).',
  'settings.mail.error.failed': 'L’e-mail n’a pas pu être envoyé.',
  'settings.mail.field.loopback_required':
    'Proton Mail Bridge tourne sur cet ordinateur : utilisez 127.0.0.1 ou localhost.',
  'settings.mail.field.preset_host':
    'Ce fournisseur impose son serveur ; choisissez « Autre (SMTP) » pour un autre.',
  'settings.mail.field.security_mismatch': 'Le port 465 utilise TLS et le port 587 STARTTLS.',
  'settings.mail.field.required': 'Saisissez le mot de passe.',
  'settings.mail.field.invalid_address':
    'Saisissez une adresse comme marie@example.com ou « Marie <marie@example.com> ».',
  'settings.mail.help.gmail':
    'Gmail demande un mot de passe d’application, pas votre mot de passe habituel. Il faut que la validation en deux étapes soit activée sur votre compte Google. Créez-le sur',
  'settings.mail.help.icloud':
    'iCloud demande un mot de passe pour app (identification à deux facteurs activée). Créez-le dans Connexion et sécurité sur',
  'settings.mail.help.yahoo':
    'Yahoo demande un mot de passe d’application : Sécurité du compte → Générer un mot de passe d’application.',
  'settings.mail.help.protonBridge':
    'Proton Mail Bridge doit tourner sur la même machine qu’Almanach. Copiez l’identifiant et le mot de passe affichés dans Bridge (pas votre mot de passe Proton).',
  'settings.mail.help.protonToken':
    'Avec une offre Proton payante et un domaine personnalisé, créez un jeton SMTP dans Proton Mail : Paramètres → IMAP/SMTP → Jetons SMTP.',
  'settings.mail.help.outlook':
    'Outlook.com et Hotmail n’acceptent plus les mots de passe : vous vous connectez avec Microsoft et autorisez l’envoi une fois.',
  'settings.mail.help.outlookSetup':
    'La connexion Outlook nécessite une application enregistrée chez Microsoft, une fois par serveur. L’administrateur du serveur procède ainsi (détails dans docs/email.md) :',
  'settings.mail.help.outlookStep1':
    'Dans le portail Azure (Microsoft Entra ID → Inscriptions d’applications), créez une inscription pour « Comptes personnels uniquement », sans adresse de redirection.',
  'settings.mail.help.outlookStep2':
    'Dans Authentification, réglez « Autoriser les flux de clients publics » sur Oui.',
  'settings.mail.help.outlookStep3':
    'Dans Autorisations d’API, ajoutez SMTP.Send et offline_access (déléguées).',
  'settings.mail.help.outlookStep4':
    'Copiez l’ID d’application (client) dans MS_OAUTH_CLIENT_ID de la configuration du serveur, puis redémarrez Almanach.',
  'settings.mail.outlook.title': 'Connexion Microsoft',
  'settings.mail.outlook.body':
    'Saisissez votre adresse Outlook ou Hotmail ci-dessus, puis connectez-vous : Microsoft affiche une page où vous tapez un code et autorisez l’envoi.',
  'settings.mail.outlook.connectedBody': 'La boîte est connectée. Almanach renouvelle l’accès tout seul.',
  'settings.mail.outlook.badge': 'Connectée',
  'settings.mail.outlook.connect': 'Se connecter avec Microsoft',
  'settings.mail.outlook.reconnect': 'Reconnecter',
  'settings.mail.outlook.step':
    'Ouvrez cette page, connectez-vous avec l’adresse ci-dessus et saisissez le code :',
  'settings.mail.outlook.code': 'Code à saisir',
  'settings.mail.outlook.waiting': 'En attente de votre accord sur la page Microsoft…',
  'settings.mail.outlook.connected': 'Boîte Outlook connectée.',
  'settings.mail.outlook.declined': 'L’accès a été refusé sur la page Microsoft.',
  'settings.mail.outlook.expired': 'Le code a expiré. Reconnectez-vous pour en obtenir un nouveau.',
  'settings.mail.remove': 'Retirer la boîte d’envoi',
  'settings.mail.remove.consequence':
    'Les e-mails ne partent plus ; le mot de passe ou l’accès Microsoft enregistré est effacé.',
  'settings.mail.remove.env':
    'Le mot de passe ou l’accès Microsoft enregistré est effacé. La configuration du serveur continue d’envoyer les e-mails.',
  'nav.home': 'Accueil',
  'clients.delete.label': 'Supprimer ce client',
  'missions.delete.label': 'Supprimer cette mission',
  'custom.delete.label': 'Supprimer cette échéance',
  'calendar.empty.body': 'Changez de période, ou ajoutez votre propre échéance.',
  'clients.missions.empty.body': 'Créez-en une pour suivre le temps et facturer ce client.',
  'time.unbilled.none.body': 'Le temps saisi sur des missions à l’heure ou à la journée apparaîtra ici.',
  'time.week.empty.body': 'Lancez le chrono ou ajoutez une saisie ci-dessus.',
};
