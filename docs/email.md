# Envoi des e-mails

Almanach envoie des e-mails pour les rappels (échéances, factures en retard, seuils) et pour les
messages de test. L'envoi se règle de deux façons, dans cet ordre de priorité :

1. **Variables d'environnement** `SMTP_URL` (et `SMTP_FROM`) : si `SMTP_URL` est définie, elle
   est toujours utilisée, et les réglages de l'interface sont ignorés (ils restent affichés, avec
   la mention que la configuration du serveur prime). Le mot de passe reste dans l'environnement.
2. **Réglages de l'interface**, **Notifications → Envoi des e-mails** (`/settings/email`) : un administrateur choisit un fournisseur,
   saisit l'adresse et le mot de passe d'application, puis envoie un e-mail de test. Le réglage
   vaut pour toute l'instance.
3. Sinon, aucun e-mail n'est envoyé ; les notifications restent visibles dans l'application et
   par ntfy.

Tout le monde peut consulter le réglage ; seuls les administrateurs peuvent le modifier, le tester
ou le supprimer. L'e-mail de test part vers l'adresse du compte de l'administrateur, dans sa langue.

## Prérequis : `SECRETS_KEY`

Les mots de passe et les jetons Microsoft sont stockés chiffrés (AES-256-GCM) avec `SECRETS_KEY`
(32 octets en base64, `openssl rand -base64 32`). Sans elle, aucun secret ne peut être enregistré
(erreur `secrets_key_missing`). Garde `SECRETS_KEY` avec tes sauvegardes : si elle change, il faut
ressaisir le mot de passe ou reconnecter la boîte Outlook. Aucun secret n'est jamais renvoyé à
l'interface : elle sait seulement qu'un mot de passe est enregistré.

## Ports et sécurité

- **Port 25 : jamais.** Il est refusé partout : la plupart des hébergeurs et des fournisseurs
  d'accès le bloquent, et il n'est pas fait pour l'envoi authentifié.
- **465** : TLS implicite (chiffré dès la connexion), réglage « TLS ».
- **587** : STARTTLS obligatoire (la connexion passe en chiffré avant l'authentification),
  réglage « STARTTLS ». Almanach refuse d'envoyer si le serveur ne propose pas STARTTLS.
- Seule exception : **Proton Mail Bridge**, qui écoute sur un autre port (1025 par défaut), et
  seulement sur une adresse locale (`127.0.0.1`, `localhost`, `::1`).

Pour les fournisseurs listés, l'hôte et les ports sont imposés par Almanach, d'après leur
documentation. « Autre » accepte n'importe quel hôte, sur 465 ou 587.

## Fournisseurs

| Fournisseur | Serveur | Port | Identifiants |
|---|---|---|---|
| Gmail | `smtp.gmail.com` | 465 (TLS) ou 587 (STARTTLS) | Adresse Gmail + mot de passe d'application |
| iCloud | `smtp.mail.me.com` | 587 (STARTTLS) | Adresse iCloud + mot de passe pour app |
| Yahoo | `smtp.mail.yahoo.com` | 465 (TLS) ou 587 (STARTTLS) | Adresse + mot de passe d'application |
| Fastmail | `smtp.fastmail.com` | 465 (TLS) ou 587 (STARTTLS) | Adresse + mot de passe d'application |
| OVH | `ssl0.ovh.net` | 465 (TLS) ou 587 (STARTTLS) | Adresse + mot de passe de la boîte |
| Infomaniak | `mail.infomaniak.com` | 465 (TLS) ou 587 (STARTTLS) | Adresse + mot de passe (d'application si la double authentification est active) |
| Proton Mail Bridge | `127.0.0.1` | 1025 (STARTTLS) | Identifiant et mot de passe affichés par Bridge |
| Proton (jeton SMTP) | `smtp.protonmail.ch` | 587 (STARTTLS) | Adresse + jeton SMTP |
| Outlook.com / Hotmail | `smtp-mail.outlook.com` | 587 (STARTTLS) | Connexion Microsoft (OAuth2), pas de mot de passe |

### Gmail

Google refuse le mot de passe du compte : il faut un **mot de passe d'application**, qui
n'existe que si la **validation en deux étapes** est activée sur le compte. Crée-le sur
<https://myaccount.google.com/apppasswords> et colle les 16 caractères dans Almanach.

### Proton : Bridge ou jeton SMTP

- **Proton Mail Bridge** est une application qui tourne sur la même machine qu'Almanach et
  chiffre les messages localement. Almanach s'y connecte sur `127.0.0.1` (port 1025 par défaut)
  avec l'identifiant et le mot de passe que Bridge affiche (pas ceux du compte Proton). Bridge
  présente un certificat autosigné : Almanach l'accepte, uniquement parce que la connexion reste
  sur la machine. Si Almanach tourne dans un conteneur, Bridge doit écouter dans le même espace
  réseau.
- **Jeton SMTP** (offres payantes avec domaine personnalisé) : créé dans les réglages Proton
  (IMAP/SMTP → jetons SMTP), il s'utilise avec `smtp.protonmail.ch` sur le port 587, sans Bridge.

### Outlook.com / Hotmail

Microsoft n'accepte plus de mot de passe en SMTP pour les comptes personnels : l'envoi passe par
**OAuth2**. Almanach utilise le *device code flow* : il affiche un code, tu l'ouvres sur la page
Microsoft depuis n'importe quel appareil, tu te connectes et tu acceptes, puis Almanach reçoit un
jeton de rafraîchissement, stocké chiffré. Il en tire des jetons d'accès d'une heure, et enregistre
à chaque fois le nouveau jeton de rafraîchissement que Microsoft renvoie. Si Microsoft refuse le
jeton (mot de passe changé, accès révoqué), le test renvoie `oauth_failed` : reconnecte la boîte.

Il faut d'abord **enregistrer ta propre application** chez Microsoft (gratuit, une fois par
instance), puis donner son identifiant au serveur :

1. Ouvre le portail Azure ou Microsoft Entra, **App registrations → New registration**.
2. Nom libre (par exemple « Almanach »). Types de comptes : **Personal accounts only** (ou « Any
   Entra ID Tenant + Personal Microsoft accounts »). Aucune URI de redirection n'est nécessaire.
3. Dans **Authentication → Advanced settings**, mets **Allow public client flows** à **Yes**.
   Aucun secret client n'est créé : Almanach est un client public.
4. Dans **API permissions**, ajoute les permissions déléguées `SMTP.Send` (Office 365 Exchange
   Online, ou celle proposée sous Microsoft Graph) et `offline_access`.
5. Copie l'**Application (client) ID** dans `MS_OAUTH_CLIENT_ID` et redémarre Almanach.
6. Dans les réglages E-mail, choisis Outlook, saisis l'adresse de la boîte et l'expéditeur, clique
   sur « Connecter », puis suis le code affiché.

Détails techniques : tenant `consumers`, demande du code sur
`https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode`, jetons sur `/token`, portée
`https://outlook.office.com/SMTP.Send offline_access`, authentification SMTP `XOAUTH2`. Le code
d'appareil reste sur le serveur, en mémoire ; il n'est jamais envoyé au navigateur.

## Erreurs du test

| Code | Signification probable |
|---|---|
| `auth_failed` | Identifiant ou mot de passe refusé (mot de passe du compte au lieu d'un mot de passe d'application, par exemple). |
| `connection_failed` | Serveur introuvable ou connexion refusée (hôte mal saisi, Bridge arrêté). |
| `timeout` | Pas de réponse : le port est probablement bloqué par l'hébergeur ou un pare-feu. |
| `tls_failed` | Échec TLS : sécurité qui ne correspond pas au port, ou certificat invalide. |
| `oauth_failed` | Microsoft refuse le jeton : reconnecte la boîte Outlook. |
| `not_configured` | Aucun envoi réglé. |
| `secrets_key_missing` | `SECRETS_KEY` absente ou changée depuis l'enregistrement. |
| `failed` | Autre erreur ; le détail renvoyé par le serveur s'affiche avec le code. |

## Sources

- Microsoft, device code flow (point d'accès, paramètres, erreurs `authorization_pending`,
  `authorization_declined`, `bad_verification_code`, `expired_token` ; jeton de rafraîchissement
  seulement avec `offline_access`) :
  <https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code>
- Microsoft, OAuth pour IMAP, POP et SMTP (portée `https://outlook.office.com/SMTP.Send`, format
  XOAUTH2) :
  <https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth>
- Microsoft, réglages POP, IMAP et SMTP d'Outlook.com (`smtp-mail.outlook.com`, 587, STARTTLS,
  OAuth2 requis) :
  <https://support.microsoft.com/en-us/office/pop-imap-and-smtp-settings-for-outlook-com-d088b986-291d-42b8-9564-9c414e2aa040>
- Microsoft, rafraîchir le jeton d'accès (paramètres, pas de secret pour un client public, le
  nouveau jeton de rafraîchissement remplace l'ancien) :
  <https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow#refresh-the-access-token>
- Microsoft, enregistrer une application (« Personal accounts only ») :
  <https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app>
- Microsoft, application de bureau (Authentication → Advanced settings → Allow public client
  flows) :
  <https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-registration>
- Google, mots de passe d'application (validation en deux étapes requise) :
  <https://support.google.com/accounts/answer/185833>
- Google, serveurs IMAP et SMTP de Gmail (`smtp.gmail.com`, 465 TLS implicite, 587 STARTTLS) :
  <https://developers.google.com/gmail/imap/imap-smtp>
