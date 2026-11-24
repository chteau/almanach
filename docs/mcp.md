# Serveur MCP

Almanach expose un serveur [MCP](https://modelcontextprotocol.io) sur `/mcp` pour qu'un assistant IA
(Claude Code, Claude Desktop…) lise tes données et, si tu l'autorises, prépare des brouillons.

## Activer

1. Un administrateur coche **Réglages → Instance → Autoriser le point d'accès MCP**, ou l'administrateur
   du serveur pose `MCP=true`. Sinon `/mcp` répond 404.
2. Dans **Réglages → Jetons personnels (MCP)**, crée un jeton avec un nom et une portée :
   - **Lecture** (`read`) : uniquement les outils de lecture ;
   - **Lecture + brouillons** (`read_drafts`) : en plus, créer ou modifier un client et créer un
     brouillon de devis ou de facture.
   - **Lecture + pipeline** (`read_pipeline`) : en plus des outils de lecture, créer et modifier une piste et
     noter une relance faite. Portée distincte, jamais accordée par les deux autres ; aucun outil ne marque un
     devis accepté ni n'envoie de relance.

   Le jeton (`alm_…`) n'est affiché qu'une fois ; seule son empreinte SHA-256 est stockée. La liste
   montre sa date de dernière utilisation ; « Révoquer » le supprime aussitôt.
3. Ajoute le serveur à Claude Code :

```sh
claude mcp add --transport http almanach http://localhost:8090/mcp --header "Authorization: Bearer <jeton>"
```

(adapte l'adresse à ton instance ; en dehors de ta machine, passe par HTTPS).

## Outils

Chaque outil agit dans une entreprise du compte du jeton : paramètre `company` (identifiant ou nom),
par défaut la première. Montants en centimes.

| Outil | Portée | Rôle |
|---|---|---|
| `list_companies` | read | entreprises du compte et leurs activités (principale, secondaires) |
| `search_clients` | read | recherche de clients, y compris ceux des instances liées et sources externes |
| `list_documents` | read | devis, factures, avoirs : filtres type, statut, période, activité ; documents liés et externes avec leur `source` et `test` |
| `get_document` | read | document détaillé (local ou en lecture seule) |
| `list_payments` | read | paiements et recettes des instances liées |
| `list_deadlines` | read | échéances à venir ou en retard |
| `list_expenses` | read | dépenses simples (montant HT, TVA, catégorie, activité, pièce du coffre) et usage dans le pays |
| `list_vault_items` | read | pièces du coffre (métadonnées seulement, jamais le contenu) : filtres `expiringWithinDays`, `kind`, `client` |
| `list_deals` | read | pistes du pipeline (étape, nom du client ou du prospect, montant, devis lié, prochaine action, `late`) : filtres `stage`, `dueOnly` |
| `weekly_review` | read | point de la semaine (`weeklyReview/1`) : actions triées, échéances, encaissements, factures, devis sans réponse, seuils, réserve ; `allCompanies` pour toutes les entreprises |
| `prepare_declaration` | read | déclaration préparée d'une échéance (`key`, ou la prochaine non faite) : chiffres par case, montant à payer avec méthode et étapes, lien du portail |
| `get_thresholds` | read | seuils (y compris à la baisse, `direction: below`), estimations de cotisations et d'impôt, ventilation par activité, simulation, maturité du pack par fonctionnalité (`pack.features` : absente = indisponible) |
| `get_dashboard` | read | résumé du tableau de bord, dont la ventilation par activité et la réserve (`reserve`) |
| `get_reserve` | read | réserve « à mettre de côté » : estimations de l'exercice à date × (1 + marge) + supplément personnel − déjà payé, avec étapes, sources et maturité |
| `list_linked_activities` | read | instances liées et sources externes |
| `create_client`, `update_client` | read_drafts | créer ou modifier un client |
| `create_draft_document` | read_drafts | créer un **brouillon** de devis ou de facture |
| `create_deal`, `update_deal` | read_pipeline | créer une piste ou en changer quelques champs (étape journalisée) |
| `log_follow_up` | read_pipeline | noter une relance faite et la prochaine date ; n'envoie rien |

Aucun outil n'émet, n'envoie, ne numérote, ne supprime ni ne touche aux réglages, liaisons, sources ou
jetons : l'émission se fait toujours dans Almanach. Les données de test sont exclues par défaut
(`includeTest`) et toujours marquées `test: true`.

## Sécurité et limites

- Transport « Streamable HTTP » sans état, réponses JSON (pas de flux SSE) : `POST /mcp` ; `GET` et
  `DELETE` répondent 405. Implémentation minimale du protocole (révisions 2025-06-18, 2025-03-26,
  2024-11-05) plutôt que le SDK officiel, qui tirerait Express et une dizaine de dépendances.
- 120 requêtes par minute et par adresse, et autant par jeton ; corps limité à 256 Kio ; une page web
  d'un autre site est refusée (en-tête `Origin`).
- Les outils réutilisent les routes de l'API : mêmes validations, mêmes calculs, même blocage après
  cessation d'activité. Un jeton ne voit que les entreprises de son propriétaire. Chaque écriture est
  journalisée (`mcp.write`).
