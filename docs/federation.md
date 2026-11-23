# Liaison entre instances

Une micro-entreprise n'a qu'un SIRET, mais elle peut exercer plusieurs activités : par exemple du
développement en freelance (BNC) suivi sur un serveur d'entreprise joignable seulement par VPN, et
un SaaS (BIC prestations de services) suivi sur un serveur perso. Le plafond du régime micro, la
franchise de TVA et leurs alertes se calculent sur le **cumul** des activités. La liaison permet à
deux instances Almanach de se transmettre ce cumul sans rien partager d'autre.

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
totaux, s'il **reçoit** ceux de l'autre, et s'il **appelle** l'autre (toutes les 6 heures, plus le
bouton « Synchroniser »).

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

Jamais de facture, de client, de montant unitaire, de nom ou d'identifiant. Des totaux reçus dans une
autre devise sont refusés.

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
- **Appels sortants** : délai de 10 secondes, aucune redirection suivie, réponse limitée à 256 Ko.
- **Routes `/api/federation/*`** : limitées à 30 requêtes par minute et par adresse, 404 tant que
  les liaisons ne sont pas autorisées ou qu'aucune n'est active ou en attente d'appairage.
- **Export JSON** : la configuration des liaisons (adresse, nom, partage, réception, appel), jamais
  de clé, de secret ni de totaux reçus. À l'import, les liaisons sont inactives (« À refaire ») :
  révoquez-les et refaites l'appairage.

### Modèle de menace

- **Pair compromis** : il peut au pire envoyer de faux totaux, donc fausser les seuils affichés
  chez vous, ou cesser de répondre. Il ne peut rien lire d'autre : les routes de fédération ne
  servent que les totaux mensuels, et seulement si vous les partagez. Il ne peut pas se faire
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
d'elle disparaissent, et l'autre instance en est avertie par une requête signée si elle est
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
