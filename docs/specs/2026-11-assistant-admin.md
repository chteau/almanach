# Spécification — Assistant administratif

> Statut : proposition, à valider par le fondateur. Rédigée le 24 novembre 2026.
> Périmètre : six fonctions génériques dans le cœur, déclinées par les packs pays (`packs/fr`, `packs/de`,
> `packs/uk`, `packs/us`). Ce document ne remplace pas le cahier des charges : ses « Exigences impératives »
> priment (serveur seul juge des montants, règles en YAML avec `source` et `verified_on`, i18n FR/EN/DE,
> tests Vitest et Playwright, WCAG AA, argent en unités mineures entières).

## Sommaire

0. Ce qui existe déjà et principes communs
1. Déclaration préparée
2. Réserve « à mettre de côté »
3. Coffre à documents avec expiration
4. Suivi des missions et prospects
5. Point hebdomadaire (`weekly_review`)
6. Facturation électronique
7. Plan de livraison en lots
8. Points à trancher
9. Sources consultées

Convention : **[vérifié AAAA-MM-JJ]** = lu sur la source officielle citée à cette date ;
**[à vérifier]** = non confirmé, à contrôler sur la source avant d'entrer dans un pack. Aucune valeur marquée
« à vérifier » ne doit être livrée dans un pack `verified`.

---

## 0. Ce qui existe déjà et principes communs

### 0.1 Socle réutilisé

| Brique | Où | Rôle pour cette spec |
|---|---|---|
| Schéma des règles annuelles | `packages/shared/src/rules.ts` (`yearRulesSchema`) | `thresholds`, `estimates` (formules `flat`, `brackets`, `profit_bands`, `us_self_employment`, `de_income_tax`), `allowances`, `deadlines` ; tout objet porte `source` + `verified_on` ; schémas `.strict()` |
| Métadonnées de pack | `packages/shared/src/packs.ts` (`packMetaSchema`) | statuts, options, identifiants, règles de facture |
| Moteur | `packages/shared/src/engine.ts` | `expandDeadlines`, `computeEstimates`, `activityBreakdown`, `measureThresholds`, `RuleProfile.activities` |
| Échéances détaillées | `PlanningService.deadline()` | CA de la période, estimations, ventilation par activité, marque « fait » (`deadline_marks.actualCents`) |
| Perspectives | `PlanningService.outlook()` | estimations à date, projection, seuils, ventilation par activité |
| Rappels | `apps/server/src/features/planning/reminders.ts` (`ReminderJob`, toutes les 10 min) | notifications dédupliquées (`notifications.dedupeKey`), canaux e-mail / ntfy, heures calmes, offsets `reminderDays` |
| Activités | table `company_activities`, colonne `activity_id` sur documents, paiements, échéances perso | **chantier en cours** (activités multiples) |
| Chiffrement | `apps/server/src/security/secrets.ts` (AES-256-GCM, `SECRETS_KEY` 32 octets) | réutilisé pour le coffre |
| MCP | `apps/server/src/features/mcp/mcp.ts` (`TOOLS`, portées `read` / `read_drafts`, appels via les routes de l'API) | nouveaux outils |
| PDF | `apps/server/src/features/documents/pdf.ts` (pdf-lib 1.17.1, polices standard) | base de Factur-X |

### 0.2 Principes

- **Cœur générique, pays en données.** Le cœur ne connaît ni « Urssaf », ni « BNC », ni « Umsatzsteuer ». Il
  connaît des *mesures* (CA encaissé, CA facturé, base HT par taux de TVA, TVA collectée…), des *méthodes*
  (somme d'estimations, quote-part de l'an passé, montant saisi) et des *types de pièces*. Le pack dit lesquelles
  s'appliquent, avec libellés, sources et dates. Quand une logique ne s'exprime pas en données, elle devient un
  nouveau `kind` de formule pure et testée (comme `de_income_tax`), jamais un `if (country === 'FR')`.
- **Calcul serveur uniquement**, à la lecture (pas de montant stocké qui pourrait diverger), sauf ce que la
  personne saisit (montant réellement payé, avis d'acompte).
- **Prudence et transparence.** Chaque montant estimé expose ses étapes (`steps`, déjà présent dans
  `EstimateResult`), sa source et sa date de vérification, et un avertissement localisé fourni par le pack.
- **Rien n'est transmis à une administration.** Almanach prépare, rappelle et exporte ; la personne déclare et
  paie sur le portail officiel (`link` de l'échéance).
- **Compatibilité des packs.** Les schémas étant `.strict()`, un pack qui contient les nouveaux champs sera
  refusé par une instance plus ancienne. Chaque lot qui étend le schéma doit : rendre les champs optionnels,
  et faire publier par le canal de mise à jour des bundles qui déclarent la version minimale d'Almanach
  **[à vérifier : le format de `packBundles` / `updates.ts` porte-t-il déjà une version minimale ?]**.
- **Activités multiples.** Toute agrégation se fait par activité (`activityBreakdown`) puis se somme, comme le
  moteur le fait déjà ; une ligne sans `activity_id` appartient à l'activité principale.
- **UI hors Réglages.** Aucune fonction ne dépend de la refonte des Réglages : chaque réglage propre à une
  fonction s'édite depuis la page de la fonction (dialogue), et sera déplacé plus tard si la refonte le veut.
- **Migrations.** Numérotées à la suite au moment du lot (≥ `0018`, les chantiers en cours ayant pris `0016` et
  `0017`) ; jamais deux lots en parallèle sur `drizzle/meta/_journal.json`.

---

## 1. Déclaration préparée

### 1.1 Objectif utilisateur

« Pour ma prochaine échéance, quels chiffres je recopie, dans quelle case, et combien je vais payer ? » —
avec un rappel quelques jours avant, et la possibilité de noter ce qui a été réellement déclaré et payé.

### 1.2 Extension du schéma de pack (`rules.ts`)

Bloc optionnel `prepare` sur une règle d'échéance :

```yaml
deadlines:
  - id: urssaf_monthly
    # … champs existants …
    prepare:
      basis: collected            # collected | invoiced : encaissé ou facturé (date d'émission)
      span: period                # period | fiscal_year_to_period_end (cumul depuis le début d'exercice, UK MTD)
      lines:                      # une ligne = une case à remplir
        - id: ca_bnc
          label: { fr: "CA BNC (prestations libérales)", en: …, de: … }
          measure: revenue        # mesure du cœur, voir 1.3
          statuses: [micro_bnc]   # filtre par statut d'activité (activités multiples)
        - id: ca_bic_services
          label: …
          measure: revenue
          statuses: [micro_bic_services]
      amount:                     # ce qui sera payé à cette échéance
        method: estimates         # estimates | prior_year_share | user_entered | annualized_share
      note: { fr: …, en: …, de: … }
      source: https://…
      verified_on: "2026-11-24"
```

Méthodes de montant (`amount.method`), génériques :

| Méthode | Calcul | Exemple |
|---|---|---|
| `estimates` | somme des `estimates` de la règle sur les lignes de la période (déjà fait par `PlanningService.deadline`) | FR cotisations micro |
| `prior_year_share` | `shareBp` × impôt de l'exercice précédent (saisi par la personne ou issu des marques de l'an passé) | UK payments on account (50 %) |
| `user_entered` | montant saisi depuis un avis (stocké, voir 1.4) ; à défaut, aucune estimation affichée | DE Vorauszahlung (Vorauszahlungsbescheid) |
| `annualized_share` | (estimation annuelle projetée − déjà payé sur l'exercice) / échéances restantes, plancher 0 | US 1040-ES |

### 1.3 Mesures du cœur

Calculées sur les documents émis et paiements, par activité, dans la devise principale (même conversion que
`receipts()`), données de test exclues :

- `revenue` — CA HT encaissé (`basis: collected`) ou facturé (`invoiced`), avoirs déduits ;
- `vat_base` + `vatRateBp` — base HT des lignes au taux donné (mode `standard`) ;
- `vat_collected` + `vatRateBp` optionnel — TVA collectée ;
- `vat_mode_base` + `vatMode` (`reverse_charge`, `export`, `franchise`) — base HT des opérations dans ce mode ;
- `expenses` — toujours `null` aujourd'hui (Almanach ne suit pas les dépenses) ; la ligne s'affiche « à saisir ».

Le cœur n'interprète jamais l'`id` d'une ligne.

### 1.4 Modèle de données

Migration `00xx_declaration_prepared.sql` :

```sql
ALTER TABLE deadline_marks ADD COLUMN declared jsonb;        -- { [lineId]: cents } recopié par la personne
CREATE TABLE deadline_notices (                              -- montants issus d'un avis (method user_entered)
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  rule_id text NOT NULL,
  fiscal_year integer NOT NULL,
  per_occurrence_cents bigint,                               -- ex. Vorauszahlung trimestrielle
  prior_year_tax_cents bigint,                               -- base de prior_year_share
  note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, rule_id, fiscal_year)
);
```

`actualCents` (existant) reste le montant réellement payé.

### 1.5 API et MCP

- `GET /api/deadlines/:key` (existant) gagne un objet `prepared` :
  `{ basis, span, periodStart, periodEnd, lines: [{ id, label, cents | null, byActivity: [...] }], amount: { method, cents | null, steps, warning }, note, source, verifiedOn, declared }`.
- `PUT /api/deadlines/:key/mark` accepte `declared` (validé : chaque clé ∈ `prepare.lines[].id`).
- `PUT /api/deadline-notices/:ruleId/:year` (schéma strict, montants ≥ 0).
- MCP `prepare_declaration` (portée `read`) : `{ company, key? }` ; sans `key`, la prochaine échéance non faite
  qui a un bloc `prepare`. Renvoie `prepared` + `link` du portail.
- Rappel : `ReminderJob.collect` inchangé dans son principe ; le texte de `deadline_soon` gagne le montant
  préparé quand il existe (`params.amount`, `params.currency`) — pas de nouveau type de notification.

### 1.6 UI

Page **Détail d'une échéance** (`/calendar/:key`, `DeadlinePage.tsx`) : section « À déclarer » (tableau des
lignes, bouton copier par case, ventilation par activité dépliable), « À payer » (montant, étapes, avertissement),
puis « Marquer comme déclaré » (pré-rempli avec les montants préparés, modifiables). Le tableau de bord montre la
prochaine déclaration préparée en une carte. Avis d'acompte : petit formulaire dans la même page quand la méthode
est `user_entered` ou `prior_year_share`.

### 1.7 Règles par pays

**France — déclaration de CA micro-entrepreneur (Urssaf)**
- Mensuelle ou trimestrielle selon l'option, même à CA nul ; échéances et dates déjà dans `packs/fr/2026.yaml`
  (`urssaf_monthly`, `urssaf_quarterly`), source service-public F23257 [vérifié 2026-11-18 dans le pack].
- `basis: collected` (CA encaissé). Une ligne par activité : BNC, BIC prestations de services, BIC ventes, chacune
  à son taux (commentaire du pack, FAQ autoentrepreneur.urssaf.fr) [vérifié 2026-11-24 dans le pack ; la page
  FAQ Urssaf n'a pas pu être relue le 2026-11-24 — à revérifier].
- `amount.method: estimates` : cotisations + versement libératoire si option, déjà modélisés.
- CFP : le pack la laisse hors échéance faute de calendrier concordant ; la déclaration préparée l'affiche
  « non rattachée » et la réserve (§2) l'inclut.

**Allemagne**
- *Umsatzsteuer-Voranmeldung* (non applicable au Kleinunternehmer, `withoutOptions: [kleinunternehmer]` déjà dans
  le pack) : dépôt au plus tard le 10e jour après la période ; période trimestrielle par défaut, mensuelle si la
  taxe de l'année précédente dépasse 9 000 €, dispense possible jusqu'à 2 000 € ; mensuelle l'année de création et
  la suivante (§ 18 Abs. 1-2 UStG) [vérifié 2026-11-24]. Prolongation d'un mois (Dauerfristverlängerung) :
  prévue par voie réglementaire (§ 18 Abs. 6 UStG, §§ 46-48 UStDV) [à vérifier ; option de pack à ajouter].
  Lignes : base 19 %, base 7 %, TVA collectée, prestations intra-UE en autoliquidation, autres non imposables ;
  numéros de case (« Kennzahlen » du formulaire USt 1 A 2026) [à vérifier — ne pas les citer avant lecture du
  formulaire officiel]. `basis` : `invoiced` (Sollbesteuerung) par défaut, `collected` si
  Istversteuerung (§ 20 UStG) [à vérifier : seuil et option de pack à créer].
  `amount.method: estimates` sur une nouvelle estimation « TVA due = TVA collectée » (pas de TVA déductible
  suivie) — l'avertissement le dit.
- *Einkommensteuer-Vorauszahlungen* : 10 mars, 10 juin, 10 septembre, 10 décembre, montant fixé par le
  Finanzamt par avis (Vorauszahlungsbescheid), sur la base de la dernière imposition ; seuils 400 €/an et 100 €
  par échéance (§ 37 Abs. 1, 3, 5 EStG) [vérifié 2026-11-24]. `amount.method: user_entered`.
- *Kleinunternehmerregelung* (§ 19 UStG) : pas de Voranmeldung ; seuils 25 000 € (année précédente) et
  100 000 € (année en cours) déjà surveillés dans le pack [vérifié 2026-11-18 dans le pack].
- Gewerbesteuer-Vorauszahlungen (`gewst_vorauszahlung`, statut `gewerbe`) : `user_entered` (avis de la commune).

**Royaume-Uni**
- *MTD for Income Tax quarterly updates* : obligation à partir du 6 avril 2026 si revenu « qualifying » > 50 000 £
  (année 2024-25), 6 avril 2027 > 30 000 £, 6 avril 2028 > 20 000 £ [vérifié 2026-11-24, gov.uk]. Échéances
  déjà dans le pack (`mtd_quarterly_update`, périodes cumulées depuis le 6 avril) → `span: fiscal_year_to_period_end`,
  lignes « turnover » et « expenses » (à saisir). La transmission exige un logiciel reconnu par HMRC : Almanach
  prépare les chiffres, ne transmet pas (voir §8).
- *Self Assessment payments on account* : deux acomptes, 31 janvier et 31 juillet, chacun en général la moitié de
  l'impôt de l'année précédente (Class 4 incluse) ; pas dus si l'impôt précédent < 1 000 £ ou si plus de 80 % a été
  prélevé à la source ; solde au 31 janvier suivant [vérifié 2026-11-24, gov.uk]. `amount.method:
  prior_year_share` avec `shareBp: 5000`, base saisie dans `deadline_notices.prior_year_tax_cents`.
- **Le pack UK est en cours de modification par un autre chantier** : les blocs `prepare` UK attendent sa fusion.

**États-Unis**
- *Estimated tax (Form 1040-ES)* : dû si l'impôt attendu ≥ 1 000 $ ; périodes et échéances : 1/1-31/3 → 15 avril,
  1/4-31/5 → 15 juin, 1/6-31/8 → 15 septembre, 1/9-31/12 → 15 janvier ; report au jour ouvré suivant
  [vérifié 2026-11-24, irs.gov]. Pénalité évitée si l'on a payé au moins 90 % de l'impôt de l'année ou 100 % de
  celui de l'an passé [vérifié 2026-11-24] ; règle des 110 % au-delà d'un certain revenu [à vérifier, Pub. 505].
  `amount.method: annualized_share` sur `self_employment_tax` + `income_tax_*` ; option « safe harbor » =
  `prior_year_share` à 25 % de l'impôt de l'an passé [à vérifier : choix produit à trancher].
- *Sales tax* : **hors périmètre** (État par État, nexus) ; la page le dit.
- Impôts d'État sur le revenu : non modélisés ; avertissement.

### 1.8 Cas limites

Période sans aucun encaissement (afficher 0, pas « vide » : la déclaration à zéro est obligatoire en FR) ;
paiements en devise sans taux (réutiliser `unconverted`, bloquer « prêt à déclarer » tant qu'il en reste) ;
avoir sur une période antérieure ; paiement sans activité (activité principale) ; changement de statut ou
d'option en cours de période (`segments()`) ; cessation (`ceasedOn`) ; échéance sans période (CFE) → pas de
lignes ; activité secondaire suivie par instance liée (compter ses recettes attachées, comme aujourd'hui) ;
données de test exclues ; montant saisi négatif refusé.

### 1.9 Tests

Vitest : une fonction pure `prepareDeclaration(rules, profile, receipts, documents, occurrence)` dans
`engine.ts`, cas réels par pack (FR mixte BNC + BIC, DE trimestre avec 19 % et autoliquidation, UK cumul MTD,
US 3e période de 3 mois) ; validation du schéma `prepare` (lignes en double, statut inconnu). Playwright :
ouvrir une échéance FR, copier les cases, marquer déclaré, vérifier le tableau de bord.

### 1.10 Taille

M (≈ 4-5 jours) : schéma + moteur 1,5 j, API/MCP 1 j, UI 1,5 j, packs FR/DE/US 1 j (UK après fusion du chantier UK).

---

## 2. Réserve « à mettre de côté »

### 2.1 Objectif utilisateur

Voir en permanence combien garder sur le compte pour les cotisations et l'impôt pas encore payés, et à chaque
encaissement « de ce paiement, mets X de côté ».

### 2.2 Méthode générique

```
réserve = Σ estimations de l'exercice à date (engine.computeEstimates sur les recettes de l'exercice,
          ids listés par reserve.include, ventilées par activité)
        × (1 + marge prudente)
        + supplément personnel (% du CA et/ou montant fixe mensuel, saisis par la personne)
        − Σ montants déjà payés sur cet exercice pour ces estimations
          (deadline_marks.actualCents des échéances faites ; à défaut, l'estimation de l'échéance)
plancher : 0
```

Part d'un paiement : différence de réserve avant / après ce paiement (calculée, non stockée).

Bloc optionnel de pack dans `<année>.yaml` :

```yaml
reserve:
  include: [contributions_bnc, contributions_bic_services, income_tax_bnc, cfp_liberal]   # ids d'estimations
  settles:                       # quelles échéances soldent quelles estimations, et pour quel exercice
    - { deadline: urssaf_monthly, fiscalYear: period }       # period | previous | current
    - { deadline: payment_on_account_1, fiscalYear: current }
  marginBp: 1000                 # marge prudente proposée par défaut (modifiable par la personne)
  warning: { fr: …, en: …, de: … }
  source: https://…
  verified_on: "…"
```

Le pack choisit la marge ; elle n'est pas une valeur légale, le YAML le dit dans un commentaire et `source`
pointe la règle de calcul des estimations incluses.

### 2.3 Modèle de données

Migration `00xx_reserve.sql` :

```sql
CREATE TABLE reserve_settings (
  company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  margin_bp integer,                 -- null = marge du pack
  extra_rate_bp integer NOT NULL DEFAULT 0,      -- ex. impôt d'État US, Kranken-/Pflegeversicherung DE
  extra_monthly_cents bigint NOT NULL DEFAULT 0,
  extra_note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

### 2.4 API et MCP

- `GET /api/reserve` → `{ currency, reserveCents, byActivity, components: [{ id, label, estimatedCents, paidCents, steps, source, verifiedOn }], marginBp, extra, warning, asOf }`.
- `PUT /api/reserve/settings` (strict ; `margin_bp` 0-5000, `extra_rate_bp` 0-5000).
- `POST /api/documents/:id/payments` (existant) renvoie en plus `reserveShareCents`.
- `GET /api/dashboard` inclut `reserve` (résumé) ; MCP `get_dashboard` en hérite ; nouvel outil `get_reserve`
  (portée `read`).

### 2.5 UI

Carte « À mettre de côté » sur le **tableau de bord** (montant, détail dépliable, avertissement, lien
« Ajuster » ouvrant un dialogue pour la marge et le supplément) ; même bloc en tête de la page **Seuils et
estimations** (`/thresholds`). Après l'enregistrement d'un paiement (`PaymentsPage`, `DocumentDetail`) :
bandeau « Mettez 312,40 € de côté ». Aucun élément dans Réglages.

### 2.6 Règles par pays

| Pack | `include` | Remarques |
|---|---|---|
| FR micro | cotisations du statut (25,6 % BNC SSI, 23,2 % Cipav, 21,2 % BIC services, 12,3 % ventes), VL si option (2,2 / 1,7 / 1 %), CFP (0,2 / 0,1 / 0,3 %) — valeurs déjà au pack, sources service-public F36232, Légifrance, impots.gouv.fr, F23459 [vérifié 2026-11-18] | sans VL, l'impôt sur le revenu dépend du foyer : non estimé ; l'avertissement invite à ajouter un supplément personnel. ACRE déjà gérée. |
| DE | `income_tax` (§ 32a EStG, base « profit » = CA faute de dépenses → surestimation prudente), TVA collectée non reversée si non Kleinunternehmer | Solidaritätszuschlag, Kirchensteuer, Gewerbesteuer, assurance maladie/dépendance : non modélisés [à vérifier avant tout ajout] → supplément personnel ; `settles`: `est_vorauszahlung`, `ust_voranmeldung_*`. |
| UK | `income_tax` / `income_tax_scotland`, `class4_nic` (sources gov.uk [vérifié 2026-11-24 dans le pack]) | `settles`: payments on account (`current`), solde 31 janvier (`previous`). Attendre la fusion du chantier UK. |
| US | `self_employment_tax`, `income_tax_single` / `_joint` (IRS, Rev. Proc. 2025-32 [vérifié 2026-11-18 dans le pack]) | impôt d'État non modélisé → supplément ; `settles`: `estimated_tax` (`period`), `form_1040` (`previous`). |

Avertissement commun (i18n, texte du pack) : estimation indicative, calculée sur le CA sans dépenses, hors
situation du foyer ; ne remplace pas un avis de l'administration.

### 2.7 Cas limites

Remboursement / avoir après paiement (réserve qui baisse, jamais négative) ; échéance payée plus que l'estimation
(surplus non reporté sur l'exercice suivant, affiché) ; exercice décalé (UK 6 avril) ; changement de statut en
cours d'exercice ; ACRE qui se termine ; paiement en devise non convertie (exclu et signalé) ; instance liée
attachée à une activité (comptée) ou non (non comptée, comme `outlook`).

### 2.8 Tests

Vitest : `computeReserve()` pure dans `engine.ts` ; FR mensuel (réserve = CA du mois en cours × taux après
paiement d'octobre), UK (acomptes affectés au bon exercice), US (1040-ES payés), marge et supplément, plancher 0.
Playwright : saisir un paiement, voir le bandeau puis la carte du tableau de bord.

### 2.9 Taille

S (≈ 2-3 jours). Lot le plus petit et le plus utile : premier livré.

---

## 3. Coffre à documents avec expiration

### 3.1 Objectif utilisateur

Retrouver en dix secondes l'attestation d'assurance ou l'avis de situation demandé par un client, et être
prévenu avant qu'une pièce expire.

### 3.2 Types de pièces (pack)

Nouveau bloc optionnel `vault` dans `pack.yaml` :

```yaml
vault:
  kinds:
    - id: rc_pro
      label: { fr: "Attestation d'assurance RC professionnelle", en: …, de: … }
      expires: true              # la date d'expiration est demandée
      remindDays: [30, 7]
      appliesTo: { statuses: [...] }   # optionnel
      source: https://…          # facultatif quand le type n'a pas de base légale
      verified_on: "…"
```

Types du cœur toujours disponibles : `client_contract` (lié à un client et éventuellement une mission),
`other`. Propositions par pack :

| Pack | Types proposés | État |
|---|---|---|
| FR | attestation RC Pro ; avis de situation au répertoire SIRENE (Insee) ; attestation d'immatriculation / extrait (RNE, Kbis si RCS) ; contrat de domiciliation ; attestation de vigilance Urssaf (souvent demandée par les clients, validité de 6 mois) | obligations et validité [à vérifier : art. L8222-1 et D8222-5 du Code du travail, page Urssaf] |
| DE | Gewerbeanmeldung (statut `gewerbe`) ; courrier d'attribution de la Steuernummer ; Bescheinigung in Steuersachen ; Berufshaftpflicht | [à vérifier] |
| UK | lettre UTR (HMRC) ; certificat d'enregistrement VAT (option `vat_registered`) ; professional indemnity insurance ; décision de statut IR35 reçue d'un client | [à vérifier] |
| US | lettre de confirmation d'EIN (CP 575) ; copie du W-9 remis aux clients ; licence commerciale locale/État ; certificat d'assurance | [à vérifier] |

Les types ne portent pas de règle fiscale : ils peuvent entrer dans un pack sans `source`, mais une durée de
validité légale (ex. vigilance 6 mois) exige une source.

### 3.3 Modèle de données

Migration `00xx_vault.sql` :

```sql
CREATE TABLE vault_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  activity_id uuid REFERENCES company_activities(id) ON DELETE SET NULL,
  kind text NOT NULL,                 -- id de type du pack ou du cœur
  title text NOT NULL,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  mission_id uuid REFERENCES missions(id) ON DELETE SET NULL,
  issued_on date,
  expires_on date,
  remind_days jsonb,                  -- null = valeur du type
  notes text,
  file_name text, mime_type text, size_bytes integer, sha256 text,   -- null si pièce sans fichier
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vault_items_company_expiry_idx ON vault_items (company_id, expires_on);
CREATE TABLE vault_blobs (            -- séparé pour que les listes ne chargent jamais les fichiers
  item_id uuid PRIMARY KEY REFERENCES vault_items(id) ON DELETE CASCADE,
  data bytea NOT NULL                 -- 'v1' | iv(12) | tag(16) | chiffré
);
```

Stockage dans PostgreSQL (pas de répertoire de données aujourd'hui ; le logo est déjà en base) : les
sauvegardes `pg_dump` couvrent le coffre.

### 3.4 Sécurité et limites

- **Chiffrement** : AES-256-GCM, clé dérivée de `SECRETS_KEY` par HKDF-SHA256 (`info = "almanach-vault-v1"`),
  IV aléatoire par fichier ; ajouter `encryptBytes` / `decryptBytes` à `security/secrets.ts` (même format
  versionné que `encryptSecret`). Sans `SECRETS_KEY`, les fiches (dates, rappels) fonctionnent mais l'envoi de
  fichier est refusé (`vault_key_missing`) avec une explication ; aucune écriture en clair.
- **Types acceptés** : PDF, PNG, JPEG, vérifiés par signature d'octets côté serveur (pas par l'extension ni le
  `Content-Type`). Pas de SVG ni d'HTML (contenu actif).
- **Taille** : 8 Mio par fichier (= limite `largeBody` existante de `app.ts`, route ajoutée à `largePaths`) ;
  quota 250 Mio par entreprise, variable `VAULT_QUOTA_MB` [à trancher].
- Téléchargement : `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, contrôle
  d'appartenance à l'entreprise ; journal d'audit `vault.upload`, `vault.download`, `vault.delete`.
- Lecture seule après cessation (comme le reste).
- Export (`export.ts`, format `almanach-export/2`) : métadonnées incluses, fichiers exclus par défaut [à trancher].
- MCP : métadonnées seulement, jamais le contenu des fichiers.

### 3.5 API et MCP

`GET/POST /api/vault`, `GET/PUT/DELETE /api/vault/:id`, `PUT /api/vault/:id/file` (multipart),
`GET /api/vault/:id/file`, `GET /api/vault/kinds` (types du pack + cœur). MCP `list_vault_items` (portée
`read`, filtres `expiringWithinDays`, `kind`, `client`).

Rappels : `ReminderJob.collect` ajoute `vault_expiring` (dédup `vault:<id>:<offset>`) et `vault_expired`
(dédup `vault:<id>:expired`), avec les offsets du type, lien `/vault/:id`. Textes ajoutés dans `TEXT` de
`reminders.ts` et côté web.

### 3.6 UI

Nouvelle page **Coffre** (`/vault`, `/vault/:id`), entrée dans le menu principal (`AppShell`, `MenuPage`) :
liste groupée « Expire bientôt / À jour / Sans date », filtres par type et activité, ajout par glisser-déposer
avec choix du type. Onglet « Documents » sur la **fiche client** (contrats). Le Centre de notifications reçoit
les rappels.

### 3.7 Cas limites

Fichier remplacé (nouvelle version écrase, l'ancienne n'est pas conservée — [à trancher]) ; pièce sans date ;
date d'expiration passée à la création (notification immédiate « expirée ») ; client supprimé/archivé ; perte de
`SECRETS_KEY` (fichiers illisibles : message clair, fiche conservée) ; quota atteint ; PDF chiffré par mot de
passe (accepté tel quel) ; double envoi (même `sha256` → avertissement).

### 3.8 Tests

Vitest : aller-retour chiffrement, détection de signature (PDF/PNG/JPEG acceptés, SVG/HTML/ZIP refusés),
quota, offsets de rappel, isolation entre entreprises. Playwright : déposer une attestation, voir la
notification d'expiration simulée, télécharger.

### 3.9 Taille

M (≈ 4 jours).

---

## 4. Suivi des missions et prospects

### 4.1 Objectif utilisateur

Ne plus oublier de relancer un devis : un pipeline léger prospect → devis envoyé → relance → gagné / perdu,
relié aux clients, devis et missions existants, avec la prochaine action datée.

### 4.2 Modèle de données

Aujourd'hui `missions.status` contient déjà `prospect`. On ajoute un objet dédié, plus léger qu'une mission :

```sql
CREATE TABLE deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  activity_id uuid REFERENCES company_activities(id) ON DELETE SET NULL,
  client_id uuid REFERENCES clients(id) ON DELETE RESTRICT,   -- null tant que le prospect n'est pas client
  prospect_name text,                                         -- requis si client_id est null
  prospect_contact text,
  title text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('lead','quote_sent','follow_up','won','lost')),
  amount_cents bigint, currency text,
  quote_id uuid REFERENCES documents(id) ON DELETE SET NULL,
  mission_id uuid REFERENCES missions(id) ON DELETE SET NULL,
  next_action_on date, next_action text,
  lost_reason text,
  closed_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deals_company_stage_idx ON deals (company_id, stage);
CREATE INDEX deals_company_next_idx ON deals (company_id, next_action_on);
CREATE TABLE deal_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  kind text NOT NULL,          -- stage_changed | follow_up_done | note
  from_stage text, to_stage text, note text,
  at timestamptz NOT NULL DEFAULT now()
);
```

Transitions automatiques (serveur) : devis lié marqué `sent` → `quote_sent` et `next_action_on` = envoi + N
jours (réglage du pipeline, 7 par défaut) ; devis `accepted` → `won` et proposition « créer la mission » ;
`declined` → `lost`. Passage manuel libre, toujours journalisé. Gagné/perdu fixent `closed_on`.

### 4.3 API et MCP

`GET/POST /api/deals`, `GET/PUT/DELETE /api/deals/:id`, `POST /api/deals/:id/follow-up` (note + prochaine
date), `POST /api/deals/:id/convert-client` (crée le client à partir du prospect, mêmes validations que
`clients.routes`). MCP : `list_deals` (`read`, filtres étape, `dueOnly`) ; `create_deal`, `update_deal`,
`log_follow_up` en `read_drafts` [à trancher : la portée `read_drafts` est aujourd'hui décrite comme « clients et
brouillons »]. Aucun outil ne marque un devis accepté ni n'envoie de relance : l'assistant rédige, la personne
envoie.

Rappels : `deal_follow_up` dans `ReminderJob.collect` le jour de `next_action_on`, puis `deal_follow_up_late`
une fois (dédup par `deal:<id>:<date>`).

### 4.4 UI

Nouvelle page **Pipeline** (`/pipeline`) : colonnes par étape (cartes ≥ 44 px, déplacement au clavier par menu
« Changer d'étape », pas seulement en glisser-déposer, pour WCAG), vue liste sur mobile ; filtre activité ;
total pondéré non (simple total par étape). Bloc « Pistes » sur la **fiche client** et sur le **devis**
(`DocumentDetail`). Entrée de menu à côté de Missions.

Pas de règle fiscale par pays. i18n habituelle.

### 4.5 Cas limites

Devis supprimé (brouillon) → lien nul ; devis lié à une autre piste (un devis = une piste au plus) ; client
archivé ; devise différente de la devise principale (total par devise) ; piste rouverte après « perdu » ;
cessation (lecture seule) ; missions `prospect` existantes (voir §8).

### 4.6 Tests

Vitest : machine d'états et transitions automatiques, conversion prospect → client, rappels. Playwright :
créer une piste, lier un devis, le marquer envoyé, voir la relance datée, accepter → mission proposée.

### 4.7 Taille

M (≈ 4-5 jours).

---

## 5. Point hebdomadaire (`weekly_review`)

### 5.1 Objectif utilisateur

Une fois par semaine, en deux minutes (ou via un assistant qui lit Almanach) : ce qui arrive, ce qui est en
retard, l'argent entré, ce qu'il faut garder, qui relancer, quoi renouveler.

### 5.2 Contenu (JSON stable, versionné `weeklyReview/1`)

```jsonc
{
  "format": "weeklyReview/1",
  "company": { "id": "…", "name": "…" },
  "week": { "start": "2026-11-23", "end": "2026-11-29", "today": "2026-11-24", "timezone": "Europe/Paris" },
  "currency": "EUR",
  "actions": [                       // triées par urgence ; chaque entrée est autoportante
    { "id": "deadline:urssaf_monthly:2026-11-01", "type": "declaration", "due": "2026-11-30",
      "title": "…", "why": "…", "amountCents": 128000, "link": "/calendar/…", "source": "https://…" }
  ],
  "deadlines": { "overdue": [], "next14Days": [] },        // avec le bloc `prepared` résumé (§1)
  "cash": { "collectedThisWeekCents": 0, "collectedLastWeekCents": 0, "invoicesOverdue": [], "invoicesDueThisWeek": [] },
  "quotes": { "awaitingAnswer": [] },                      // envoyés, sans réponse, avec ancienneté
  "thresholds": [],                                        // ≥ 80 % ou dépassés
  "reserve": { "reserveCents": 0, "deltaThisWeekCents": 0, "warning": "…" },
  "deals": { "followUpsDue": [], "followUpsLate": [] },
  "vault": { "expiringWithin60Days": [], "expired": [] },
  "notices": [ "pack_update_available", "unconverted_payments" ],
  "testDataExcluded": true
}
```

Chaque section se dégrade proprement quand la fonction n'est pas encore livrée (champ absent, pas d'erreur),
ce qui permet de livrer le point hebdomadaire avant le coffre et le pipeline.

### 5.3 API, MCP, UI

- `GET /api/review/weekly?date=YYYY-MM-DD` (semaine ISO contenant la date, fuseau de l'instance). Agrège les
  services existants (`calendar`, `openInvoices`, `outlook`, réserve, pipeline, coffre) ; aucun calcul nouveau.
- MCP `weekly_review` (portée `read`) : `{ company?, date?, allCompanies?: boolean }` — `allCompanies` renvoie un
  tableau, un point par entreprise du compte. Description de l'outil rédigée pour un assistant : « commence par
  `actions` ; les montants sont en centimes ; ne rien présenter comme un avis fiscal ».
- Vue **Point de la semaine** (`/review`), lien depuis le tableau de bord ; impression propre (CSS print).
- **Aucune planification serveur nouvelle** : pas d'envoi hebdomadaire automatique. Les rappels existants
  continuent ; un assistant peut appeler l'outil à la fréquence que la personne configure de son côté.

### 5.4 Cas limites

Semaine à cheval sur deux exercices (UK : 6 avril) ; entreprise cessée ; aucune donnée (point vide mais valide) ;
plusieurs entreprises ; jeton MCP d'un autre compte (refus, comme aujourd'hui).

### 5.5 Tests

Vitest : agrégation avec sections absentes, tri des actions, frontières de semaine et fuseau. MCP : schéma de
sortie stable (test de contrat). Playwright : la vue s'affiche, liens actifs.

### 5.6 Taille

S (≈ 2 jours) une fois les lots 1 et 2 livrés ; +0,5 jour par section ajoutée ensuite.

---

## 6. Facturation électronique

### 6.1 Objectif utilisateur

Émettre une facture conforme au format électronique exigé dans son pays et à la date exigée, sans changer sa
façon de facturer. **Almanach produit et exporte le fichier ; la transmission via une plateforme agréée (France)
ou un réseau (Peppol) est un chantier séparé, non couvert ici.**

### 6.2 Obligations par pays

**France** [vérifié 2026-11-24, impots.gouv.fr « Je découvre la facturation électronique », mise à jour du
26/05/2026 ; economie.gouv.fr ; dépliant DGFiP micro-entreprises]
- Réception obligatoire pour toutes les entreprises assujetties à la TVA **depuis le 1er septembre 2026**,
  y compris en franchise en base et les micro-entrepreneurs.
- Émission obligatoire : grandes entreprises et ETI au 1er septembre 2026 ; PME et micro-entreprises au plus tard
  le **1er septembre 2027**. L'e-reporting (B2C, international, données de paiement des prestations de
  services) suit le même calendrier.
- Transmission **par une plateforme agréée** (liste publiée sur impots.gouv.fr) ; un PDF simple envoyé par e-mail
  ne sera plus conforme.
- Formats du socle : UBL, CII, ou format mixte (Factur-X), compatibles EN 16931 ; norme AFNOR XP Z12-012 avec
  profils EN16931 et EXTENDED-CTC-FR, et BASIC WL temporaire en Factur-X [vérifié 2026-11-24 sur la norme
  publiée par impots.gouv.fr et fnfe-mpe.org]. **Cible Almanach : Factur-X profil EN16931.** Acceptation du
  profil BASIC par les plateformes [à vérifier].
- Nouvelles mentions obligatoires (SIREN du client, adresse de livraison si différente, nature des opérations
  biens/services, option pour la TVA sur les débits) [à vérifier : texte en vigueur, art. 242 nonies A de
  l'annexe II du CGI, et date d'application].
- Codes d'exonération (VATEX) pour la franchise en base, l'autoliquidation, l'export [à vérifier : liste CEF
  VATEX en vigueur et règles françaises].

**Allemagne** [vérifié 2026-11-24, § 27 Abs. 38 UStG, § 34a UStDV ; BMF-Schreiben du 15.10.2025 et mise à jour
du 15.10.2026 repérée mais non lue intégralement]
- Réception d'une E-Rechnung obligatoire pour toute entreprise depuis le 1er janvier 2025.
- Émission : jusqu'au 31 décembre 2026, papier ou autre format électronique (avec accord du destinataire)
  permis pour tous ; en 2027, encore permis si le chiffre d'affaires total (§ 19 Abs. 2 UStG) de l'année
  précédente ne dépasse pas 800 000 € ; ensuite, E-Rechnung obligatoire entre entreprises établies en
  Allemagne (à partir du 1er janvier 2028).
- Kleinunternehmer : § 34a UStDV permet de toujours transmettre leur facture comme « sonstige Rechnung » →
  dispense d'émission, la réception reste due [vérifié 2026-11-24 sur le texte ; portée confirmée par le BMF à
  vérifier].
- Formats : XRechnung (CIUS allemande d'EN 16931, UBL ou CII) et ZUGFeRD à partir du profil EN16931
  (techniquement identique à Factur-X) [à vérifier dans le BMF-Schreiben : profils ZUGFeRD admis].

**Royaume-Uni** [vérifié 2026-11-24, gov.uk « VAT: electronic invoicing » et « Roadmap for e-invoicing
implementation »]
- Aucune obligation B2B aujourd'hui. Annoncé au Budget 2025 : factures de TVA électroniques obligatoires à
  partir d'**avril 2029** ; feuille de route publiée au Budget 2026 ; pouvoirs habilitants dans le Finance Bill
  2026-27, exigences détaillées (périmètre, formats) d'ici octobre 2027-avril 2028 ; Peppol comme cadre
  d'interopérabilité. Hors périmètre de ce lot ; le pack UK déclare `mandate: []` et une note.

**États-Unis** — pas d'obligation fédérale d'e-facture B2B [à vérifier : aucune source officielle unique
consultée ; à confirmer avant de l'écrire dans le pack]. Export UBL possible à la demande, sans promesse de
conformité.

### 6.3 Extension du schéma de pack (`packs.ts`, bloc `invoice`)

```yaml
invoice:
  # … existant …
  einvoice:
    formats:
      - { id: facturx, profile: EN16931, syntax: CII }     # PDF/A-3 + XML intégré
      - { id: ubl, profile: EN16931 }
    default: facturx
    mandates:
      - { scope: receive, from: "2026-09-01", source: …, verified_on: … }
      - { scope: issue, from: "2027-09-01", appliesTo: { statuses: [...] }, source: …, verified_on: … }
    requiredFields: [buyer_siren, delivery_address, operation_nature]   # champs supplémentaires exigés
    exemptionCodes: { franchise: "…", reverse_charge: "…", export: "…" } # [à vérifier] avant remplissage
```

Le cœur n'utilise `mandates` que pour afficher une bannière (« obligatoire pour vous à partir du … ») et une
échéance d'information dans le calendrier ; il ne bloque jamais l'émission.

### 6.4 Conception technique

- **Modèle sémantique EN 16931** (BT/BG) construit à partir d'une facture émise (`documents`, snapshots
  `seller` / `buyer` déjà figés), dans `packages/shared/src/einvoice.ts` (pur, testé) ; sérialiseurs CII (D16B,
  Factur-X/ZUGFeRD) et UBL 2.1 côté serveur (`features/documents/einvoice/`). Génération XML sans dépendance
  (gabarits échappés), ou une bibliothèque XML auditée [à trancher].
- **Factur-X = PDF/A-3** : le PDF actuel utilise les polices standard de pdf-lib, **non intégrées**, ce qui est
  incompatible avec PDF/A. Il faut intégrer une police (Geist, déjà charte) via `@pdf-lib/fontkit` (nouvelle
  dépendance épinglée) et un profil ICC sRGB (OutputIntent), métadonnées XMP Factur-X, pièce jointe
  `factur-x.xml` avec `AFRelationship=Data`. Répond à la question ouverte du cahier des charges (§ 12) : JavaScript
  suffit, pas de service dédié.
- **Validation en CI uniquement** (pas à l'exécution) : veraPDF (PDF/A-3b), validateur Schematron EN 16931 /
  XRechnung (KoSIT) et Mustang pour Factur-X, exécutés en conteneurs dans GitHub Actions.
- **Données manquantes** : SIREN client (champ existant `clients.siret` → SIREN = 9 premiers chiffres), code pays,
  adresse structurée (aujourd'hui `address` est un texte libre : ajouter `address_lines`, `postal_code`, `city`
  aux clients et au profil — migration), adresse électronique (BT-34/BT-49) et, pour XRechnung B2G, Leitweg-ID
  (BT-10) par client.
- Les factures émises ne changent jamais : le XML est régénéré à l'identique depuis les snapshots, et une
  facture émise avant le lot n'a d'e-facture que si toutes les données requises sont dans ses snapshots.

### 6.5 Modèle de données

Migration `00xx_einvoice.sql` : colonnes `clients.address_lines jsonb`, `postal_code`, `city`,
`electronic_address`, `buyer_reference` ; `profiles.address_structured jsonb` ; `documents.einvoice_format text`
(format figé à l'émission) et `documents.einvoice_sha256 text` (empreinte du fichier produit, preuve
d'intégrité).

### 6.6 API, MCP, UI

- `GET /api/documents/:id/einvoice?format=facturx|ubl|xrechnung` → fichier (PDF ou XML) ; 422 avec la liste
  des champs manquants (`missing: ['buyer.postal_code', …]`).
- `get_document` (MCP) expose `einvoice: { available, formats, missing }`, sans le fichier.
- UI : bouton « Télécharger Factur-X / XML » à côté du PDF dans `DocumentDetail` ; contrôle des champs
  manquants dans l'éditeur (`DocumentEditor`) et la fiche client ; bannière d'obligation sur le tableau de bord
  quand un `mandate` approche (90 jours).

### 6.7 Cas limites

Franchise en base (TVA 0, catégorie et motif d'exonération), autoliquidation intra-UE, export hors UE, facture
d'acompte et facture finale déduisant les acomptes (`depositIds`), avoir référencant la facture d'origine
(BT-25), remise globale (`discountBp`), multi-devises (BT-5 ≠ EUR : montant de TVA en devise comptable BT-111),
client particulier (B2C : pas d'e-facture, e-reporting FR hors périmètre), arrondis ligne/total cohérents avec
`totals`, caractères spéciaux et longueur des champs.

### 6.8 Tests

Vitest : modèle sémantique pour chaque cas limite ; XML comparé à des fichiers de référence. CI : chaque
fichier de référence passe veraPDF + Schematron EN 16931 (+ XRechnung pour DE). Playwright : télécharger une
Factur-X d'une facture émise, message des champs manquants.

### 6.9 Taille

L (≈ 8-10 jours) : modèle + CII 3 j, PDF/A-3 2 j, UBL/XRechnung 2 j, données client structurées + UI 2 j, CI
validateurs 1 j.

---

## 7. Plan de livraison en lots

Ordre demandé : 2 → 1 → 5 → 3 → 4 → 6. Chaque lot est livrable seul (migration, API, MCP, UI, i18n FR/EN/DE,
tests, documentation `docs/mcp.md`).

### Lot A — Réserve (§2) — S

- `packages/shared/src/rules.ts` (bloc `reserve`), `engine.ts` (`computeReserve`), `index.ts`
- `apps/server/drizzle/00xx_reserve.sql`, `db/schema.ts`
- `features/planning/planning.service.ts`, `planning.routes.ts` (`/reserve`, dashboard),
  `features/documents/documents.routes.ts` (`reserveShareCents`)
- `features/mcp/mcp.ts` (`get_reserve`), `docs/mcp.md`
- `apps/web/src/features/planning/DashboardPage.tsx`, `ThresholdsPage.tsx`, `features/documents/PaymentsPage.tsx`,
  locales `plan.*.ts`
- `packs/fr/2026.yaml`, `packs/de/2026.yaml`, `packs/us/2026.yaml` ; `packs/uk/2026.yaml` après le chantier UK
- **Dépendances** : chantier *activités multiples* fusionné (touche `engine.ts`, `rules.ts`,
  `planning.service.ts`, `packs/fr/2026.yaml`) ; chantier *UK* fusionné pour la partie UK.

### Lot B — Déclaration préparée (§1) — M

- `rules.ts` (bloc `prepare`), `engine.ts` (`prepareDeclaration`, mesures)
- migration `00xx_declaration_prepared.sql`, `schema.ts`
- `planning.service.ts` (`deadline()`), `planning.routes.ts` (mark, notices), `reminders.ts` (montant dans
  `deadline_soon`)
- `mcp.ts` (`prepare_declaration`)
- `apps/web/src/features/planning/DeadlinePage.tsx`, `DashboardPage.tsx`, locales
- packs FR, DE, US ; UK après le chantier UK
- **Dépendances** : lot A (partage `settles` et les montants payés) ; activités multiples ; UK.

### Lot C — Point hebdomadaire (§5) — S

- `features/review/review.service.ts`, `review.routes.ts` (nouveau module), `app.ts` (route)
- `mcp.ts` (`weekly_review`), `docs/mcp.md`
- `apps/web/src/features/review/ReviewPage.tsx`, `app/App.tsx`, `DashboardPage.tsx` (lien), locales
- **Dépendances** : lots A et B ; sections coffre et pipeline ajoutées par les lots D et E. `App.tsx` et
  `AppShell` sont aussi touchés par la *refonte UX* : coordonner l'ajout d'entrées de menu.

### Lot D — Coffre (§3) — M

- `security/secrets.ts` (`encryptBytes`, `decryptBytes`, HKDF), `config.ts` (`VAULT_QUOTA_MB`), `.env.example`
- migration `00xx_vault.sql`, `schema.ts`
- `features/vault/vault.routes.ts`, `vault.service.ts` ; `app.ts` (`largePaths`) ; `planning/reminders.ts`
  (`vault_expiring`, `vault_expired`) ; `export/export.ts` (métadonnées)
- `packages/shared/src/packs.ts` (bloc `vault`), `vault.ts`
- `mcp.ts` (`list_vault_items`) ; `review.service.ts` (section)
- `apps/web/src/features/vault/*`, `App.tsx`, `AppShell.tsx`, `MenuPage.tsx`, `ClientDetailPage.tsx`,
  `NotificationsPage.tsx`, locales
- `packs/*/pack.yaml` (types ; UK après le chantier UK)
- **Dépendances** : refonte UX (menu) ; `export.ts` est modifié par le chantier activités multiples.

### Lot E — Pipeline (§4) — M

- migration `00xx_deals.sql`, `schema.ts` ; `packages/shared/src/deals.ts`
- `features/deals/deals.routes.ts` ; `documents.routes.ts` (transitions sur `sent` / `answer`) ;
  `reminders.ts` (`deal_follow_up`) ; `export.ts` (pistes)
- `mcp.ts` (`list_deals`, `create_deal`, `update_deal`, `log_follow_up`) ; `review.service.ts`
- `apps/web/src/features/deals/*`, `App.tsx`, `AppShell.tsx`, `ClientDetailPage.tsx`, `DocumentDetail.tsx`,
  locales
- **Dépendances** : activités multiples (`activity_id`) ; refonte UX (menu) ; `documents.routes.ts` est modifié
  par le chantier activités multiples.

### Lot F — Facturation électronique (§6) — L

- `packages/shared/src/einvoice.ts`, `packs.ts` (bloc `einvoice`), `clients.ts`, `profile.ts`
- migration `00xx_einvoice.sql`, `schema.ts`
- `features/documents/einvoice/{model,cii,ubl,facturx}.ts`, `pdf.ts` (polices intégrées, PDF/A-3),
  `documents.routes.ts`, `clients.routes.ts`, `profile.routes.ts`
- `package.json` serveur (`@pdf-lib/fontkit`, version épinglée, audit), polices et profil ICC dans `assets/`
- `.github/workflows/*` (veraPDF, KoSIT, Mustang)
- `mcp.ts` (`get_document`) ; web : `DocumentDetail.tsx`, `DocumentEditor.tsx`, `ClientFormPage.tsx`,
  onboarding (adresse structurée), locales
- `packs/fr/pack.yaml`, `packs/de/pack.yaml` ; `packs/uk/pack.yaml` (note, après le chantier UK), `packs/us/pack.yaml`
- **Dépendances** : la *refonte UX* peut déplacer l'adresse de l'entreprise dans les réglages — prévoir le
  champ dans le formulaire de profil existant et laisser la refonte le reprendre. Échéance externe : 1er
  septembre 2027 (FR) et 1er janvier 2027 (DE, > 800 000 € seulement ; le cœur de cible est sous ce seuil, donc
  1er janvier 2028).

### Synthèse

| Lot | Fonction | Taille | Dépend de |
|---|---|---|---|
| A | Réserve | S (2-3 j) | activités multiples ; UK pour le pack UK |
| B | Déclaration préparée | M (4-5 j) | A ; activités multiples ; UK |
| C | Point hebdomadaire | S (2 j) | A, B ; refonte UX (menu) |
| D | Coffre | M (4 j) | refonte UX (menu) ; activités multiples (export) |
| E | Pipeline | M (4-5 j) | activités multiples ; refonte UX (menu) |
| F | Facturation électronique | L (8-10 j) | refonte UX (profil) ; validateurs CI |

---

## 8. Points à trancher

1. **Marge prudente de la réserve** par défaut (proposition 10 %) et inclusion de l'impôt sur le revenu hors
   versement libératoire (non estimé aujourd'hui).
2. **US 1040-ES** : méthode par défaut — annualisation des revenus de l'année ou « safe harbor » sur l'impôt de
   l'an passé.
3. **UK MTD** : Almanach se limite-t-il à préparer les chiffres (choix proposé), ou vise-t-il à devenir un
   logiciel reconnu par HMRC (API MTD, reconnaissance, dépenses à suivre) ? Chantier distinct et lourd.
4. **Dépenses** : plusieurs fonctions (MTD, DE TVA déductible, impôt sur bénéfice) restent approximatives tant
   qu'Almanach ne suit pas les dépenses. Les ajouter est un chantier séparé.
5. **Coffre** : quota (250 Mio proposé), conservation des anciennes versions, inclusion des fichiers dans
   l'export.
6. **Pipeline** : que faire des missions au statut `prospect` existantes (les migrer en pistes, ou garder les
   deux) ; portée MCP des écritures de pistes (`read_drafts` élargie ou nouvelle portée).
7. **Plateforme agréée** (FR) : la réception est obligatoire depuis le 1er septembre 2026 pour tout
   micro-entrepreneur ; Almanach ne reçoit pas de factures. Dire clairement dans l'app qu'il faut une
   plateforme agréée dès maintenant pour la réception, et décider si une intégration (API d'une plateforme)
   est un objectif avant septembre 2027.
8. **Formats** : se limiter à Factur-X EN16931 (FR, DE via ZUGFeRD) dans un premier temps, ou livrer aussi
   XRechnung UBL pour les clients publics allemands.
9. **Version minimale des packs** : mécanisme à ajouter si le canal de mise à jour ne l'a pas.

---

## 9. Sources consultées

Lues le 24 novembre 2026 sauf mention contraire. Les sources déjà citées dans les packs gardent leur
`verified_on` d'origine.

**France**
- impots.gouv.fr, « Je découvre la facturation électronique » (mise à jour du 26/05/2026) —
  https://www.impots.gouv.fr/professionnel/je-decouvre-la-facturation-electronique
- economie.gouv.fr, « Tout savoir sur la facturation électronique pour les entreprises » —
  https://www.economie.gouv.fr/tout-savoir-sur-la-facturation-electronique-pour-les-entreprises
- DGFiP, dépliant micro-entreprises (mai 2026) —
  https://www.impots.gouv.fr/sites/default/files/media/1_metier/2_professionnel/EV/2_gestion/290_facturation_electronique/facturation-electronique---depliant-microentreprises.pdf
- AFNOR XP Z12-012 (mai 2025), publiée par impots.gouv.fr —
  https://www.impots.gouv.fr/sites/default/files/media/1_metier/2_professionnel/EV/2_gestion/290_facturation_electronique/specification_externes_b2b/afnor/norme-afnor-factures.pdf
- FNFE-MPE, Factur-X — https://fnfe-mpe.org/factur-x/factur-x_en/
- service-public F23257 (déclaration Urssaf), F36232 (taux), F23459 (CFP), F23267 (abattements) — via
  `packs/fr/2026.yaml` (2026-11-18 / 2026-11-24)

**Allemagne**
- § 18 UStG — https://www.gesetze-im-internet.de/ustg_1980/__18.html
- § 27 Abs. 38 UStG — https://www.gesetze-im-internet.de/ustg_1980/__27.html
- § 34a UStDV — https://www.gesetze-im-internet.de/ustdv_1980/__34a.html
- § 37 EStG — https://www.gesetze-im-internet.de/estg/__37.html
- § 19 UStG — via `packs/de/2026.yaml` (2026-11-18)
- BMF-Schreiben du 15.10.2025 (E-Rechnung) —
  https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Umsatzsteuer/Umsatzsteuer-Anwendungserlass/2025-10-15-einfuehrung-obligatorische-e-rechnung.pdf
  et version du 15.10.2026 repérée (non lue en entier) —
  https://www.bundesfinanzministerium.de/Content/DE/Downloads/BMF_Schreiben/Steuerarten/Umsatzsteuer/Umsatzsteuer-Anwendungserlass/2026-10-15-obligatorische-elektronische-rechnung.pdf
- FAQ BMF E-Rechnung (indisponible le 2026-11-24, à relire) —
  https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html

**Royaume-Uni**
- MTD for Income Tax, éligibilité —
  https://www.gov.uk/guidance/check-if-youre-eligible-for-making-tax-digital-for-income-tax
- Payments on account — https://www.gov.uk/understand-self-assessment-bill/payments-on-account
- VAT: electronic invoicing — https://www.gov.uk/government/publications/vat-electronic-invoicing
- Roadmap for e-invoicing implementation —
  https://www.gov.uk/government/publications/e-invoicing-implementation-roadmap/roadmap-for-e-invoicing-implementation

**États-Unis**
- IRS, Estimated taxes — https://www.irs.gov/businesses/small-businesses-self-employed/estimated-taxes
- IRS, FAQ estimated tax (périodes et échéances) — https://www.irs.gov/faqs/estimated-tax/individuals/individuals-2
- Form 1040-ES, self-employment tax, Rev. Proc. 2025-32 — via `packs/us/2026.yaml` (2026-11-18)
