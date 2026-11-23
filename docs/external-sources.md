# Sources externes

Une entreprise peut afficher, en lecture seule, les devis, factures et avoirs d'un autre outil (par
exemple les devis d'un SaaS). Chaque source est un flux JSON en HTTPS, protégé par un jeton Bearer.

## Activer

1. Le serveur a besoin de `SECRETS_KEY` : le jeton de chaque source est chiffré au repos
   (AES-256-GCM) et n'est jamais renvoyé à l'interface.
2. Un administrateur coche **Réglages → Instance → Autoriser les sources de documents externes**, ou
   l'administrateur du serveur pose `EXTERNAL_SOURCES=true` (la case est alors cochée et verrouillée).
   Tant que ce n'est pas fait, aucune requête ne part.
3. Dans **Réglages → Sources externes** de l'entreprise : nom (« SEKLYR prod »), adresse HTTPS du
   flux, jeton, et la case **Environnement de test** pour une instance de recette.

Almanach interroge chaque source toutes les 15 minutes ; le bouton « Synchroniser » le fait tout de
suite. Changer l'adresse d'une source demande de ressaisir le jeton.

## Ce qu'Almanach en fait

- Les documents sont copiés dans des tables à part (`external_clients`, `external_documents`), par
  source : jamais mélangés aux données locales, sans route d'écriture, hors numérotation, déclarations,
  estimations et export. Ils sont remplacés à chaque interrogation réussie et supprimés avec la source.
  Un flux en échec garde les dernières copies et affiche l'erreur.
- Ils apparaissent dans Devis, Factures, Avoirs et Clients avec le nom de la source en badge, le filtre
  « Activité » et une fiche en lecture seule. Ils sont aussi transmis par le
  [partage détaillé](federation.md) aux instances liées, marqués de leur source.
- Ils ne comptent jamais dans le chiffre d'affaires (calculé sur les encaissements) ; une source de
  test est grisée avec une pastille **DEV**, masquée par défaut (« Masquer les données de test ») et
  exclue de tous les totaux, du tableau de bord et des retards.

## Sécurité

Délai de 10 secondes, aucune redirection suivie, réponse limitée à 5 Mio, validation stricte : un champ
inconnu, un montant non entier ou un total incohérent rejette tout le flux. Le jeton n'est envoyé qu'à
l'adresse saisie avec lui.

## Format `almanach-feed/1`

```json
{
  "version": "almanach-feed/1",
  "generatedAt": "2026-11-23T10:00:00Z",
  "documents": [
    {
      "id": "42",
      "type": "quote",
      "number": "DEV-2026-0042",
      "status": "sent",
      "issuedAt": "2026-11-02",
      "validUntil": "2026-12-02",
      "currency": "EUR",
      "totalExclTaxCents": 100000,
      "taxCents": 20000,
      "totalInclTaxCents": 120000,
      "client": { "id": "7", "name": "Acme", "email": "compta@acme.fr", "country": "FR", "siret": "73282932000074", "vat": "FR44732829320" },
      "lines": [{ "label": "Offre Pro", "quantity": 1, "unitPriceCents": 100000, "totalCents": 100000 }]
    }
  ]
}
```

| Champ | Règle |
|---|---|
| `version` | exactement `almanach-feed/1` ; une autre version est refusée. |
| `generatedAt` | date-heure ISO 8601 avec fuseau. |
| `documents` | 5 000 au plus. |
| `id` | identifiant stable dans la source (1 à 100 caractères), unique par type. |
| `type` | `quote`, `invoice` ou `credit_note`. |
| `number` | numéro affiché, 80 caractères au plus. |
| `status` | `draft`, `sent`, `accepted`, `refused` (affiché « refusé »), `expired`, `cancelled`, `issued`, `partially_paid`, `paid` ou `overdue`. |
| `issuedAt`, `validUntil` | dates `AAAA-MM-JJ` ; `validUntil` facultatif. |
| `currency` | code ISO 4217 en majuscules. |
| `totalExclTaxCents`, `taxCents`, `totalInclTaxCents` | entiers en centimes, HT + TVA = TTC. |
| `client` | `id` et `name` obligatoires ; `email`, `country` (ISO 3166 alpha-2), `siret`, `vat` facultatifs. |
| `lines` | facultatif, 50 au plus : `label`, `quantity` (décimal ≥ 0), `unitPriceCents` (entier ≥ 0), `totalCents`. |

Les champs facultatifs sont omis plutôt que `null`. Toute évolution incompatible changera la version.
