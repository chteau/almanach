# Journal des modifications

Toutes les évolutions notables d'Almanach sont notées ici. Le format suit
[Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le projet suit le
[versionnage sémantique](https://semver.org/lang/fr/).

## [0.1.0] - 2026-11-24

Première version numérotée. Elle regroupe tout ce qui a été fait depuis le dernier état publié (`a19147d`).

### Ajouté

- **Activités multiples** : activités secondaires à côté du statut principal (par exemple BNC + BIC services).
  Documents, paiements et échéances personnalisées se rattachent à une activité ; plafonds et franchise de TVA
  comptent le total, cotisations, CFP, versement libératoire et abattements se calculent par activité, avec une
  ventilation dans le tableau de bord, la page des seuils et les réponses MCP. Les liaisons entre instances
  annoncent leur activité principale et s'y rattachent.
- **Maturité par fonctionnalité dans les packs** (`features`) : chaque pack déclare ce qu'il offre (seuils,
  estimations, échéances, activités, réserve, déclaration préparée, dépenses, types de pièces du coffre,
  facturation électronique) et son niveau ; ce qui n'est pas déclaré est indisponible et l'interface l'explique.
- **Version minimale des packs** (`minAppVersion`) vérifiée au chargement et à l'import signé : une instance trop
  ancienne refuse le pack et garde celui en place.
- Estimations calculées une fois sur le total de la personne quand le pack le demande (impôt et Class 4 au
  Royaume-Uni, impôt allemand, self-employment tax américaine), abattements déduits avant les estimations
  (trading allowance), seuils à la baisse (radiation de TVA britannique).
- **Envoi des e-mails réglable dans l'interface** : fournisseurs préréglés (Gmail, Outlook, iCloud, Yahoo, Proton
  Bridge), mot de passe chiffré avec `SECRETS_KEY`, port 25 refusé, e-mail de test avec messages d'erreur clairs,
  connexion Outlook.com / Hotmail en OAuth2 avec `MS_OAUTH_CLIENT_ID`. `SMTP_URL` reste prioritaire.
- **Réglages par panneaux** (`/settings/:section`) : menu latéral sur ordinateur, liste par groupes sur téléphone,
  profil modifié sur place ; toute action destructrice passe par une zone de danger avec confirmation.
- **Réserve « à mettre de côté »** par exercice : estimations à date, marge de prudence, supplément personnel et
  sommes déjà payées ; impôt sur le revenu français au barème progressif (quotient familial, plafonnement, décote)
  sans versement libératoire. Carte du tableau de bord, bloc de la page des seuils, outil MCP `get_reserve`.
- **Déclarations préparées** : chiffres par case remplis depuis les recettes, les bases et la TVA, montant à payer
  avec sa méthode et ses étapes, lien du portail ; chiffres déclarés gardés au marquage, montant dans les rappels,
  outil MCP `prepare_declaration`.
- **Point hebdomadaire** (`/api/review/weekly`, format `weeklyReview/1`) : actions triées par urgence, échéances,
  encaissements, factures en retard, devis sans réponse, seuils et réserve ; page imprimable et outil MCP
  `weekly_review`, pour une entreprise ou toutes.
- **Dépenses simples** (date, montant HT, TVA, catégorie, activité) : elles baissent le bénéfice des estimations là
  où le pays le prévoit, remplissent le total de dépenses MTD et la TVA déductible allemande, et restent
  indicatives en micro-entreprise française. Outil MCP `list_expenses`.
- **Coffre de documents chiffré** (`SECRETS_KEY`) avec types de pièces par pays, dates d'expiration et rappels,
  versions, quota d'instance `VAULT_QUOTA_MB` (250 Mo par défaut), export compris. Outil MCP `list_vault_items`.
- **Pipeline commercial** : pistes par étape pilotées par les devis (envoyé, accepté, refusé), relances et
  rappels ; les missions « prospect » existantes deviennent des pistes. Outils MCP `list_deals`, et `create_deal`,
  `update_deal`, `log_follow_up` avec la nouvelle portée de jeton `read_pipeline`.
- **PDF/A-3B** pour tous les documents, polices embarquées (Geist et Liberation Serif, SIL OFL 1.1) et profil sRGB.
- **Factur-X EN 16931** : option « PDF + Factur-X » par facture et par défaut, figée à l'émission, liste de ce qui
  manque sans bloquer le PDF classique ; adresses de clients structurées (lignes, code postal, ville).
- Validation des exemples Factur-X en CI (veraPDF, Schematron EN 16931, Mustang) avec
  `scripts/validate-einvoice.sh`.
- Jetons de design et composants d'interface partagés.

### Modifié

- Pack Royaume-Uni **vérifié** sur gov.uk pour 2026-27 : pénalités MTD corrigées (pas de points en 2026-27), règle
  des 30 jours et radiation de TVA à 88 000 £, échéance d'inscription au Self Assessment (5 octobre).
- Les dates en anglais suivent le pays de l'entreprise active (en-GB, en-US), dans l'application et les PDF.
- Le nom d'une entreprise suit le nom commercial du profil.
- Les tests de bout en bout tournent en parallèle : le parcours d'installation est un projet Playwright dont les
  autres dépendent.

### Corrigé

- Noms d'entreprise repris de l'adresse e-mail du compte (migration `0017`).
- Explication des activités indisponibles et des mises à jour de pack refusées.

### Migrations

- `0016` à `0024` : activités, noms d'entreprise, e-mail, réserve, déclarations préparées, dépenses, coffre,
  pipeline et facturation électronique. Les données existantes sont reprises : missions « prospect » en pistes
  (`0023`), adresses de clients découpées prudemment, texte libre conservé (`0024`).

[0.1.0]: https://github.com/chteau/almanach/releases/tag/v0.1.0
