<br/>
<div align="center">
    <h1 align="center">
        Almanach
    </h1>
    <br>
    <a href="https://github.com/chteau/almanach">
        <img src="assets/brand/almanach-logo.svg" alt="Logo Almanach" width="100">
    </a>
    <br>
    <br>
    <p align="center"><i>Toutes tes échéances de freelance au même endroit, sur ton serveur.</i></p>
    <div align="center">
        <img src="https://img.shields.io/badge/Bun-000000?style=for-the-badge&logo=bun&logoColor=white" alt="Badge Bun" />
        <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="Badge TypeScript" />
        <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="Badge React" />
        <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="Badge PostgreSQL" />
        <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Badge Docker" />
        <img src="https://img.shields.io/badge/Licence-AGPL--3.0-green?style=for-the-badge" alt="Badge licence AGPL-3.0" />
        <img src="https://img.shields.io/badge/Version-0.1.0-blue?style=for-the-badge" alt="Badge version 0.1.0" />
    </div>
    <br/>
    <p align="center">Français · <a href="README.en.md">English</a></p>
</div>

Almanach est un tableau de bord libre et auto-hébergé pour les indépendants : clients, missions,
devis, factures, temps passé, et surtout toutes les échéances administratives de ton pays
(déclarations, cotisations, seuils de TVA), avec ce qu'il faut mettre de côté.

Les outils qui connaissent tes obligations sont des services en ligne payants qui gardent tes
données. Les outils libres, eux, ne connaissent pas les règles de ton pays. Almanach fait les deux.

<p align="center">
    <img src="docs/screenshots/desktop-30-tableau-de-bord.png" alt="Tableau de bord d'Almanach" width="800">
</p>

## État

Version **0.1.0**, la première version numérotée ([journal des modifications](CHANGELOG.md)).
La France est le pays de référence :
ses règles 2026 sont **vérifiées**, chaque chiffre cite sa source officielle et sa date de
vérification. Le Royaume-Uni (année fiscale 2026-27, sur gov.uk), l'Allemagne et les États-Unis (impôt
fédéral seulement) sont vérifiés aussi. Les fonctionnalités encore expérimentales sont listées
ci-dessous, et l'application le dit. Le détail est dans le
[cahier des charges](docs/cahier-des-charges.md).

| Pays | Pack | Ce qui est couvert |
|---|---|---|
| France | Vérifié | Micro-entreprise (BNC, BIC services et ventes), URSSAF mensuelle ou trimestrielle, versement libératoire, ACRE, CIPAV, CFE, franchise de TVA |
| Allemagne | Vérifié | Freiberufler et Gewerbe, Kleinunternehmer, Umsatzsteuer-Voranmeldung (Soll ou Ist, Dauerfristverlängerung), Vorauszahlungen (ESt, GewSt), Solidaritätszuschlag. Hors calcul : impôt d'église, Gewerbesteuer, assurance maladie, imposition commune |
| Royaume-Uni | Vérifié | Sole trader, Self Assessment (inscription, déclarations, payments on account), income tax avec ou sans Écosse, Class 4 NIC, Making Tax Digital (trimestriel), seuil de TVA. Hors périmètre : partnerships, limited companies, flat rate scheme ; dépenses ou trading allowance déduites |
| États-Unis | Vérifié | Sole proprietor et single-member LLC, self-employment tax, Additional Medicare Tax, déduction QBI, estimated taxes (safe harbor, méthode annualisée), Form 1040 et Schedule C. Fédéral seulement (ni État ni local), célibataire ou déclaration commune |

Chaque pack déclare aussi la maturité de chaque fonctionnalité (`features` dans `pack.yaml`). Une
fonctionnalité absente est indisponible pour ce pays, et l'application l'explique.

| Fonctionnalité | France | Allemagne | Royaume-Uni | États-Unis |
|---|---|---|---|---|
| Seuils | Vérifié | Vérifié | Vérifié | — |
| Estimations | Vérifié | Vérifié | Vérifié | Vérifié |
| Échéances | Vérifié | Vérifié | Vérifié | Vérifié |
| Activités multiples | Vérifié | Vérifié | — | Vérifié |
| Réserve | Expérimental | Vérifié | Vérifié | Vérifié |
| Déclaration préparée | Vérifié | Vérifié | Vérifié | Vérifié |
| Dépenses | Vérifié | Expérimental | Vérifié | Vérifié |
| Types de pièces du coffre | Vérifié | Expérimental | Vérifié | Vérifié |
| Factur-X | Vérifié | Vérifié | — | — |

## Ce que ça fait

- **Ne rate plus une échéance.** Calendrier (mois, semaine, liste, agenda) des déclarations, des
  paiements, des fins de mission et des factures à relancer. Rappels par e-mail, par ntfy, et un
  flux iCal à ajouter dans ton agenda.
- **Sache combien mettre de côté.** Le tableau de bord estime les cotisations et l'impôt de
  l'année, suit les seuils (plafond micro, franchise de TVA) et simule « et si je facture X de
  plus ? ». La réserve donne la somme à garder de côté à date : estimations, marge de prudence,
  supplément personnel, moins ce qui est déjà payé (en France, impôt au barème progressif quand
  le versement libératoire n'est pas choisi).
- **Déclare sans recalculer.** Chaque échéance qui le permet arrive préparée : chiffres par case,
  montant à payer avec sa méthode et ses étapes, lien du portail officiel. Le point hebdomadaire
  résume la semaine (actions triées, échéances, encaissements, factures en retard, devis sans
  réponse, seuils, réserve), sur une page imprimable.
- **Facture proprement.** Devis, factures, acomptes et avoirs en PDF, en français, anglais ou
  allemand, avec les mentions légales de ton pays et de celui du client. Numérotation, logo,
  couleur, mise en page et police se règlent dans les réglages. Changer la numérotation après la
  première facture attend le 1er janvier, pour ne pas casser la série de l'année. Chaque PDF est
  un PDF/A-3B aux polices embarquées ; une facture peut porter sa **Factur-X EN 16931**, prête à
  déposer sur une plateforme agréée ([détails](docs/einvoicing.md)). Les adresses des clients
  sont structurées (lignes, code postal, ville).
- **Suis tes affaires.** Un pipeline de pistes, du premier contact au devis accepté : les étapes
  suivent les devis envoyés, acceptés ou refusés, et les relances arrivent dans les rappels.
- **Note tes dépenses.** Montant HT, TVA, catégorie, activité : elles baissent le bénéfice des
  estimations là où le pays le prévoit et remplissent les déclarations préparées (en
  micro-entreprise française, elles restent indicatives : l'abattement forfaitaire s'applique).
- **Range tes pièces.** Un coffre chiffré pour l'attestation d'assurance, l'extrait Kbis ou
  l'attestation de vigilance, avec les types de pièces de ton pays, les dates d'expiration et un
  rappel avant l'échéance.
- **Compte ton temps.** Minuteur, saisie manuelle, grille de la semaine, facturation du temps pas
  encore facturé en un clic.
- **Suis ta situation.** Changement de statut ou de pays à une date donnée : chaque échéance suit
  la situation de la période qu'elle couvre. Une cessation d'activité garde les dernières
  déclarations et passe le compte en lecture seule.
- **Arrive avec tes clients.** Import CSV depuis ton ancien outil, avec un rapport des lignes
  refusées avant d'importer quoi que ce soit ([format](docs/import-csv.md)).
- **Garde la main sur les règles.** Les mises à jour de packs sont signées (Ed25519). Une mise à
  jour reçue n'est jamais appliquée d'office : tu lis ce qui change, en clair (« le taux passe de
  25,6 % à 26 % au 1er juillet 2026 »), puis tu appliques ou tu reportes. Retour au pack livré en
  un clic.
- **Sépare tes entreprises.** Plusieurs structures dans un même compte (une micro-entreprise et une
  SASU, ou une activité dans un autre pays), chacune avec ses clients, factures, temps, échéances,
  seuils et estimations. Une deuxième micro-entreprise française active déclenche un avertissement :
  on n'en a qu'une, les activités se déclarent sous le même SIRET.
- **Mélange tes activités.** Plusieurs activités dans une même entreprise (BNC et BIC services,
  par exemple) : plafonds et franchise de TVA comptent le total, cotisations et abattements se
  calculent par activité. Documents, paiements et liaisons entre instances se rattachent à une
  activité.
- **Branche Stripe.** Les clients Stripe deviennent des clients de l'entreprise et les paiements
  encaissés des recettes rattachées à leur client, avec une clé en lecture seule
  ([détails](docs/stripe.md)).
- **Relie deux instances.** Une micro-entreprise, deux activités suivies dans deux instances (une
  derrière un VPN, l'autre perso) : plafonds, franchise de TVA et alertes comptent le cumul. Seuls
  des totaux mensuels par catégorie fiscale transitent, par requêtes signées Ed25519
  ([détails](docs/federation.md)).
- **Ajoute des sources externes.** Devis et factures d'un autre outil, lus depuis un flux HTTPS
  `almanach-feed/1`, en lecture seule et marqués de leur source ; les sources de test et le mode test
  de Stripe restent hors de tous les totaux ([détails](docs/external-sources.md)).
- **Envoie tes e-mails comme tu veux.** Un administrateur choisit un fournisseur (Gmail, Outlook,
  iCloud, Yahoo, Proton Bridge) dans les réglages et envoie un e-mail de test ; Outlook.com et
  Hotmail se connectent en OAuth2 avec `MS_OAUTH_CLIENT_ID` ([détails](docs/email.md)).
- **Interroge-le depuis un assistant IA.** Serveur MCP sur `/mcp`, avec des jetons personnels en
  lecture (`read`), lecture + brouillons (`read_drafts`) ou lecture + pipeline (`read_pipeline`).
  Outils de lecture : entreprises, clients, documents, paiements, échéances, dépenses, pièces du
  coffre, pistes, point hebdomadaire (`weekly_review`), déclaration préparée
  (`prepare_declaration`), seuils, tableau de bord, réserve (`get_reserve`), activités liées ; en
  écriture, des clients et des brouillons, ou des pistes et des relances notées. Rien n'est jamais
  émis ni envoyé par un assistant ([détails](docs/mcp.md)).
- **Règle tout au même endroit.** Les réglages sont rangés par panneaux (menu latéral sur
  ordinateur, liste sur téléphone) ; toute action destructrice demande une confirmation.
- **Garde tes données.** Export JSON complet, coffre compris, réimport dans une instance neuve. Double
  authentification (TOTP), sessions révocables, verrouillage après plusieurs échecs.

## Engagements

- Gratuit et libre, pour toujours, sous licence [AGPL-3.0](LICENSE).
- Pas de version hébergée, pas d'offre payante, pas de télémétrie.
- Aucune requête vers l'extérieur tant qu'un administrateur ne l'a pas activée (mises à jour de
  packs, annonce de nouvelle version, synchronisation Stripe, liaisons entre instances, sources externes, MCP). L'autorisation
  se donne dans les réglages ou dans la configuration du serveur
  (`STRIPE_SYNC`, `FEDERATION`, `EXTERNAL_SOURCES`, `MCP`).

## Installation

Il faut Docker et Docker Compose. Ça tourne sur un serveur, un NAS ou un Raspberry Pi.

```sh
git clone https://github.com/chteau/almanach.git
cd almanach
cp .env.example .env   # puis remplis tes paramètres
docker compose up -d
```

Ouvre ensuite `http://localhost:8080`. L'assistant d'installation demande le jeton affiché dans les
logs (`docker compose logs almanach`), puis crée le compte administrateur.

Pendant les migrations au démarrage, le serveur répond déjà avec une page de maintenance (503) qui
se recharge toute seule.

### Configuration

Tout est facultatif.

| Variable | Rôle |
|---|---|
| `SMTP_URL` | Serveur d'e-mail des rappels (`smtps://utilisateur:mot-de-passe@hote:465`). Prioritaire sur l'e-mail réglé dans l'interface ; sans lui, un administrateur règle l'envoi dans les réglages ([détails](docs/email.md)). |
| `SMTP_FROM` | Expéditeur des rappels. |
| `MS_OAUTH_CLIENT_ID` | Identifiant d'application (client) d'un enregistrement Microsoft Entra à vous, client public sans secret : permet l'envoi depuis une boîte Outlook.com / Hotmail en OAuth2 ([détails](docs/email.md)). |
| `REMINDERS` | `false` coupe la tâche des rappels (active par défaut, toutes les 10 minutes). |
| `PACK_PUBLIC_KEYS` | Clés publiques Ed25519 autorisées à signer des packs, séparées par des virgules. Sans elles, aucune mise à jour n'est acceptée et seuls les packs livrés servent. |
| `PACK_UPDATE_URL` | Dossier HTTPS qui publie `index.json` et les packs signés. Vérifié une fois par jour, seulement si un administrateur l'active dans les réglages. |
| `MAINTENANCE` | `true` ne sert que la page de maintenance, par exemple pendant une restauration de sauvegarde. |
| `SECRETS_KEY` | Clé de 32 octets en base64 (`openssl rand -base64 32`) qui chiffre les secrets stockés (clés Stripe, clés privées des liaisons entre instances, mots de passe et jetons d'e-mail) et les fichiers du coffre. Sans elle, aucun de ces secrets ne peut être enregistré ni aucun fichier déposé au coffre. Garde-la avec tes sauvegardes. |
| `VAULT_QUOTA_MB` | Place du coffre pour toute l'instance, anciennes versions comprises, en Mo (250 par défaut). |
| `RELEASE_CHECK_URL` | Adresse interrogée une fois par jour pour annoncer une nouvelle version, seulement si un administrateur l'active. |
| `STRIPE_SYNC` | `true` autorise la synchronisation Stripe sur l'instance, comme la case de **Réglages → Instance** (alors cochée et verrouillée). Absente : la case décide. Chaque entreprise l'active ensuite avec sa propre clé. |
| `FEDERATION` | `true` autorise les liaisons entre instances, de la même façon. |
| `EXTERNAL_SOURCES` | `true` autorise les sources de documents externes, de la même façon. |
| `MCP` | `true` ouvre le point d'accès `/mcp` aux jetons personnels, de la même façon. |
| `FEDERATION_INTERVAL_MINUTES` | Minutes entre deux échanges automatiques avec les instances liées (15 par défaut). Une modification locale déclenche aussi un échange une trentaine de secondes plus tard. |

### Publier une mise à jour de pack

```sh
bun apps/server/src/cli/pack-keygen.ts cles/almanach.pem            # une fois ; garde la clé privée hors ligne
bun apps/server/src/cli/pack-sign.ts packs/fr cles/almanach.pem 3 "Taux 2027" > fr-3.json
```

Importe `fr-3.json` depuis **Réglages → Packs de règles par pays**, ou publie-le à côté d'un
`index.json` (`{ "bundles": ["fr-3.json"] }`) dans le dossier `PACK_UPDATE_URL`. Le numéro doit
augmenter à chaque publication : une instance refuse toujours un pack plus ancien que le sien.

## Développement

Il faut [Bun](https://bun.sh) 1.3 ou plus récent, et PostgreSQL 16 pour les tests de bout en bout.

```sh
bun install
bun run lint && bun run typecheck && bun run test
E2E_ADMIN_URL=postgres://postgres:postgres@127.0.0.1:5432/postgres bun run test:e2e
scripts/validate-einvoice.sh ../einvoice-tools   # Factur-X : veraPDF, Schematron EN 16931, Mustang (Java 17+)
```

| Dossier | Contenu |
|---|---|
| `apps/server` | API Hono, base PostgreSQL (Drizzle), calcul des échéances, PDF, rappels. |
| `apps/web` | Interface React 19, en français, anglais et allemand. |
| `packages/shared` | Schémas Zod et calculs partagés entre le serveur et l'interface. |
| `packs/` | Règles par pays et par année, en YAML, chaque chiffre avec sa source. |
| `e2e/` | Tests Playwright sur ordinateur et mobile, avec vérification d'accessibilité (axe). |

## Contribuer

Les contributions sont les bienvenues, surtout les **packs pays** et les **traductions**. Une règle
fiscale doit citer sa source officielle et sa date de vérification, sinon elle n'est pas acceptée.
Un pack que personne n'a vérifié reste marqué expérimental.

## Avertissement

Almanach t'aide à ne rien oublier et donne des **estimations**. Ce n'est pas un conseil fiscal ou
comptable : vérifie toujours auprès des sources officielles de ton pays, indiquées dans
l'application.

## Licence

AGPL-3.0, voir [LICENSE](LICENSE).
