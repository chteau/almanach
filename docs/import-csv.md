# Import de clients au format CSV

Almanach importe des clients depuis n'importe quel outil capable d'exporter un CSV (**Clients → Importer un CSV**).

## Format

- Encodage UTF-8 (avec ou sans BOM).
- Séparateur : virgule, point-virgule ou tabulation, détecté automatiquement.
- Guillemets doubles autour des cellules contenant un séparateur ou un retour à la ligne ; `""` pour un guillemet.
- Première ligne : titres des colonnes. 1 000 lignes au plus par import.

## Colonnes reconnues

L'ordre est libre. Les titres ci-dessous sont reconnus automatiquement, en français, anglais ou allemand ;
toute autre colonne peut être associée à la main, ou ignorée.

| Champ                | Titres reconnus (exemples)                    | Valeur                                                       |
| -------------------- | --------------------------------------------- | ------------------------------------------------------------ |
| `name` (obligatoire) | nom, raison sociale, name, company, firma     | texte, 160 caractères au plus                                |
| `kind`               | type, kind, typ                               | `company` (défaut) ou `individual` / particulier / privat    |
| `email`              | email, e-mail, courriel                       | adresse e-mail                                               |
| `phone`              | téléphone, phone, telefon                     | texte, 40 caractères au plus                                 |
| `address`            | adresse, address, anschrift                   | texte, retours à la ligne permis                             |
| `country`            | pays, country, land                           | code ISO à 2 lettres (`FR`, `DE`…) ; défaut : votre pays     |
| `vat_number`         | tva, numéro de tva, vat, ust-idnr             | numéro de TVA intracommunautaire, vérifié pour les pays de l'UE |
| `currency`           | devise, currency, währung                     | code ISO à 3 lettres ; défaut : votre devise                 |
| `language`           | langue, language, sprache                     | `fr`, `en` ou `de` ; défaut : votre langue                   |
| `payment_terms_days` | délai de paiement, payment terms, zahlungsziel | nombre de jours (0 à 120) ; défaut : réglage de facturation  |
| `notes`              | notes, commentaire, bemerkung                 | texte                                                        |

## Exemple

```csv
Nom;Pays;Numéro de TVA;E-mail;Délai de paiement
Nordwind GmbH;DE;DE123456789;rechnung@nordwind.example;30
Atelier Lumen;FR;;compta@lumen.example;45
```

## Contrôles

Le bouton **Vérifier** ne crée rien : il indique combien de clients seront importés et liste chaque ligne
écartée avec sa raison (champ invalide, client déjà connu sous ce nom ou ce numéro de TVA). L'import
lui-même est tout ou rien pour les lignes valides : un incident en cours d'import n'en laisse aucune à moitié.
