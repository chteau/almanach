# Liaison entre instances

Une micro-entreprise n'a qu'un SIRET, mais elle peut exercer plusieurs activités : par exemple du
développement en freelance (BNC) suivi sur un serveur d'entreprise joignable seulement par VPN, et
un SaaS (BIC prestations de services) suivi sur un serveur perso. Le plafond du régime micro, la
franchise de TVA et leurs alertes se calculent sur le **cumul** des activités. La liaison permet à
deux instances Almanach de se transmettre ce cumul et, seulement si vous l'activez, le détail en lecture
seule (clients, factures, devis, avoirs, paiements) pour tout voir depuis une seule instance.

Chaque instance garde ses factures, clients, paiements, cotisations et impôt. Les cotisations et le
versement libératoire restent estimés sur l'activité locale ; une ligne rappelle « autre activité :
X € encaissés, cotisations gérées par l'autre instance ». L'ACRE dépend de la date de début
d'activité, commune aux deux, et réduit le taux de chaque activité sur son propre chiffre
d'affaires : il n'y a rien à cumuler.

## Activer

1. Le serveur a besoin de `SECRETS_KEY` : la clé privée de chaque liaison est chiffrée au repos
   (AES-256-GCM).
2. Un administrateur coche **Réglages → Instance → Autoriser les liaisons entre instances**, sur les
   deux instances, ou l'administrateur du serveur pose `FEDERATION=true` dans sa configuration (la
   case s'affiche alors cochée et verrouillée, « autorisé par la configuration du serveur »). Tant
   que ce n'est pas fait, aucune requête ne part et les routes `/api/federation/*` répondent 404.
3. Dans **Réglages → Instances liées** de l'entreprise, sur chaque instance : nom de l'activité
   (« Freelance », « SEKLYR ») et « Lier cette entreprise à d'autres instances ».

## Appairer

1. Sur l'instance que l'autre peut joindre, **Générer un code d'appairage**. Le code contient un
   secret à usage unique (80 bits), l'empreinte de la clé publique de cette instance et son
   adresse. Il expire au bout de 15 minutes et ne sert qu'une fois.
2. Sur l'autre instance, **Saisir un code** avec sa propre adresse. Elle crée sa paire de clés
   Ed25519, appelle la première (`POST /api/federation/pair`, signée avec sa nouvelle clé) et
   vérifie que la réponse est signée par la clé dont le code porte l'empreinte.
3. Les deux écrans affichent la même paire d'empreintes (inversée) : comparez-les.

Une paire de clés est créée par entreprise et par liaison. Chaque côté choisit s'il **partage** ses
totaux, s'il **reçoit** ceux de l'autre, s'il **appelle** l'autre, et s'il **partage** ou **reçoit** le
détail (désactivés par défaut, voir plus bas).

## Synchronisation automatique

L'instance qui appelle échange sans geste :

- toutes les 15 minutes (`FEDERATION_INTERVAL_MINUTES`, de 1 à 1440) ;
- une trentaine de secondes après toute création ou modification d'un document, d'un paiement ou d'une
  recette Stripe importée (les modifications rapprochées ne donnent qu'un échange) ;
- à l'ouverture du tableau de bord si le dernier échange date de plus de 5 minutes, sans attendre la
  réponse : la page suivante affiche les chiffres à jour.

Le bouton « Synchroniser » reste disponible. Rien ne part tant que les liaisons ne sont pas autorisées
sur l'instance et activées pour l'entreprise. L'instance appelée ne peut pas pousser ses changements :
ils arrivent au prochain appel de l'autre.

## Derrière un VPN

Une seule direction réseau suffit : l'instance qui appelle envoie ses totaux dans sa requête et
reçoit ceux de l'autre dans la réponse. Si l'instance A n'est joignable que par le VPN et que B
est publique :

- générez le code sur **B**, saisissez-le sur **A** : A appelle B pour l'appairage ;
- A est alors l'appelante (« Cette instance appelle l'autre » coché sur A, décoché sur B).

Si B est elle-même dans le VPN, n'importe quel côté peut appeler. Une adresse en HTTP n'est acceptée
que sur `localhost` ou une adresse privée (10/8, 172.16/12, 192.168/16, 100.64/10, fc00::/7),
c'est-à-dire en développement ou à travers un VPN qui chiffre déjà ; partout ailleurs, HTTPS est
obligatoire.

## Ce qui transite

Par mois civil (36 derniers mois) et par catégorie fiscale (le statut : `micro_bic_sales`,
`micro_bic_services`, `micro_bnc`), le total des encaissements dans la devise de l'entreprise, plus
le nom de l'activité et la devise :

```json
{ "label": "SEKLYR", "currency": "EUR", "months": [{ "month": "2026-11", "category": "micro_bic_services", "cents": 200000 }] }
```

Sans partage détaillé, jamais de facture, de client, de montant unitaire, de nom ou d'identifiant. Des
totaux reçus dans une autre devise sont refusés.

### Partage détaillé (facultatif)

Deux cases par liaison, décochées par défaut : « Partager le détail (clients, factures, devis, avoirs,
paiements) en lecture seule » sur l'instance qui partage, « Recevoir le détail partagé par l'autre
instance » sur celle qui le reçoit. Le détail ne transite **que si les deux sont cochées** (et le partage
et la réception des totaux) : l'instance qui reçoit l'annonce dans chaque échange signé, et l'autre
n'envoie rien avant de l'avoir lu.

L'instantané, refait à chaque échange, contient :

- les clients actifs : type, nom, e-mail, pays, SIRET, numéro de TVA ;
- les devis, factures, acomptes et avoirs émis (pas les brouillons) de l'année civile en cours et de la
  précédente : type, numéro, dates, client, statut, montants HT, TVA, TTC, encaissé et reste dû, devise,
  et les lignes (désignation, quantité, unité, prix unitaire) jusqu'à 50 par document ;
- les paiements de factures et les recettes Stripe de la même période : date, montant, devise,
  document, client, référence ;
- les documents des [sources externes](external-sources.md) de l'entreprise, marqués du nom de leur
  source (`origin`).

Les données de test (recettes et clients Stripe en mode test, documents d'une source « Environnement
de test ») portent `test: true` : l'instance qui les reçoit les affiche grisées avec une pastille DEV
et ne les compte nulle part. Ces deux marques ne sont envoyées que si elles s'appliquent ; une
instance d'une version antérieure refuse un instantané qui en contient.

Au plus 2 000 clients, 3 000 documents et 6 000 paiements (les plus récents) ; si l'instantané dépasse
6 Mio, les lignes sont omises. Les deux instances doivent être à cette version pour partager le détail ;
les totaux continuent de s'échanger avec une version antérieure.

Côté réception, ces copies vivent dans des tables à part (`federation_clients`, `federation_documents`,
`federation_payments`), par liaison : jamais mélangées aux données locales, sans route d'écriture, hors
des numérotations, des déclarations, des estimations et de l'export. Elles apparaissent dans les listes
Clients, Factures, Devis, Avoirs et Paiements avec le nom de l'activité en badge et un filtre « Activité »,
s'ouvrent dans une fiche en lecture seule (avec un lien vers l'instance d'origine), et le tableau de bord
liste leurs factures en retard. Elles sont remplacées à chaque échange et supprimées dès que l'un des
deux côtés décoche, à la révocation ou à la suppression de la liaison.

## Calcul des seuils

Le pack (`packs/fr/2026.yaml`, champ `counts`) indique quels statuts comptent pour chaque seuil.
En activité mixte, le plafond « ventes » (203 100 €, franchise 85 000 €) s'applique au chiffre
d'affaires global et le plafond « services » (83 600 €, franchise 37 500 €) à la seule part des
services (BIC services et BNC). BNC + BIC services : un seul jeu de plafonds, sur le cumul. Les
totaux reçus sont datés du 1er de leur mois. Le simulateur « et si je facture X » et les rappels de
seuil utilisent le même cumul.

## Sécurité

- **Requêtes signées** (Ed25519) sur `méthode + chemin + horodatage + nonce + empreinte SHA-256 du
  corps`. Fenêtre de ±5 minutes ; chaque nonce est mémorisé en base pendant 10 minutes et refusé
  s'il revient. Les réponses sont signées elles aussi, liées au nonce de la requête : une réponse
  ne peut pas être rejouée ni falsifiée en route.
- **Appels sortants** : délai de 10 secondes, aucune redirection suivie, réponse limitée à 8 Mio (taille
  maximale d'un instantané détaillé ; corps des requêtes `/exchange` limité de même).
- **Routes `/api/federation/*`** : limitées à 30 requêtes par minute et par adresse, 404 tant que
  les liaisons ne sont pas autorisées ou qu'aucune n'est active ou en attente d'appairage.
- **Export JSON** : la configuration des liaisons (adresse, nom, partage, réception, appel, partage et
  réception du détail), jamais de clé, de secret, de totaux reçus ni de copie du détail reçu : ces
  copies appartiennent à l'autre instance, qui les exporte elle-même. À l'import, les liaisons sont inactives (« À refaire ») :
  révoquez-les et refaites l'appairage.

### Modèle de menace

- **Pair compromis** : il peut au pire envoyer de faux totaux, donc fausser les seuils affichés
  chez vous, ou un faux détail, affiché en lecture seule sous son nom d'activité, sans effet sur vos
  numéros ni vos déclarations ; ou cesser de répondre. Il ne lit que ce que vous partagez : les totaux
  mensuels, et le détail seulement si vous avez coché son partage. Il ne peut pas se faire
  passer pour une autre liaison ni rejouer une requête.
- **Réseau** : en HTTPS, un intermédiaire ne voit rien. Même s'il pouvait lire le trafic, il ne
  peut ni forger ni rejouer une requête ou une réponse sans la clé privée.
- **Code d'appairage intercepté** : il expire en 15 minutes et ne sert qu'une fois ; si quelqu'un
  l'utilise avant vous, votre propre saisie échoue (« code inconnu ») et l'écran de la première
  instance montre une empreinte qui ne correspond pas à la vôtre : révoquez.
- **Base volée** : la clé privée est chiffrée avec `SECRETS_KEY`, qui n'est pas dans la base.
- **Utilisateur de l'instance** : un compte connecté peut faire appeler une adresse par le serveur
  lors de l'appairage ; seules les routes `/api/federation/pair` et `/exchange` sont appelées, en
  POST, et les erreurs restent génériques.

## Révocation et rotation

**Révoquer**, d'un côté ou de l'autre, supprime la liaison : la clé de l'autre et les totaux reçus
d'elle disparaissent, avec les copies du détail, et l'autre instance en est avertie par une requête signée si elle est
joignable (elle supprime à son tour). Les totaux importés sont **supprimés** plutôt que marqués
périmés : ils ne pourraient plus être mis à jour ni authentifiés, et garder le chiffre d'une
activité qui ne le partage plus fausserait les seuils sans fin. Si l'autre instance était
injoignable, elle garde sa liaison jusqu'à sa prochaine tentative, qui échoue (« la liaison y a
peut-être été révoquée ») ; révoquez aussi de ce côté.

**Injoignable** n'est pas révoqué : les derniers totaux restent utilisés, avec leur date affichée
sur le tableau de bord et dans les réglages.

**Rotation des clés** : révoquez puis refaites l'appairage ; une nouvelle paire est créée de chaque
côté. À faire si `SECRETS_KEY` ou une sauvegarde a fuité. Changer `SECRETS_KEY` rend les clés
privées illisibles : refaites alors les liaisons.
