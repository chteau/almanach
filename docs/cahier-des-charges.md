# Cahier des charges — Almanach

> Nom du projet : **Almanach** (FR et DE ; « almanac » en anglais).
> Version du document : 0.3 — 18 novembre 2026.

## Sommaire

1. Contexte et objectif
2. Utilisateurs cibles
3. Périmètre
4. Architecture des packs pays
5. Internationalisation
6. Pages et écrans, avec leurs scénarios
7. Scénarios transverses
8. États communs à toutes les pages
9. Exigences techniques
10. Critères d'acceptation de la V1
11. Feuille de route
12. Questions ouvertes

Les scénarios portent un identifiant (`S-xxx`) pour être référencés dans les maquettes, les tickets et les tests.

---

## 1. Contexte et objectif

Les développeurs indépendants (freelances, missions courtes, sous-traitance) jonglent avec des
clients, des missions, des factures et surtout des **obligations administratives propres à leur
pays** : déclarations de chiffre d'affaires, cotisations, seuils de TVA, taxes locales, factures
électroniques. Les outils qui gèrent ces spécificités sont presque tous des SaaS payants et fermés.
Les outils libres existants (Invoice Ninja, Kimai, Akaunting, Crater, Solidtime) sont génériques et
ignorent les règles nationales.

**Almanach** est un tableau de bord **libre, gratuit et auto-hébergeable** pour indépendants, dont le
cœur est générique et dont les règles fiscales et sociales sont fournies par des **packs pays**
interchangeables.

### Principes non négociables

- **Gratuit et libre**, licence **AGPL-3.0**.
- **Aucune version hébergée ni payante**, aucune télémétrie, aucun appel réseau sortant non demandé.
- **Auto-hébergement en une commande** : `docker compose up -d`.
- **Les données restent chez l'utilisateur** et s'exportent intégralement.
- **International dès la conception** : premier utilisateur français, deuxième allemand, troisième
  américain, quatrième britannique. Aucune règle nationale n'est codée en dur dans le cœur.
- **Ce n'est pas un conseil fiscal** : l'outil rappelle et estime, l'utilisateur reste responsable.

### Exigences impératives

Ces exigences priment sur tout le reste du document.

1. **Code commenté en anglais.** Chaque fonction et méthode TypeScript porte un bloc de ce format exact :

   ```ts
   /**
    * This function/method does this
    *
    * @param thing {type} - description
    * @returns {type} - description
    */
   ```

   Le code est optimisé : pas de travail inutile, pas de dépendance superflue.
2. **Serveur souverain (server authoritative), le client n'est jamais cru.** Toute validation, tout
   calcul (montants, TVA, numérotation, échéances, seuils, estimations) et tout contrôle d'accès se
   font sur le serveur. Le client affiche et propose ; il n'envoie que des intentions, revalidées
   côté serveur avec un schéma strict.
3. **Dépendances sûres.** Peu de paquets, choisis pour leur maintenance et leur sécurité, versions
   verrouillées, audit automatique en CI, mises à jour suivies.
4. **Architecture claire et conventionnelle.** Arborescence, composants React et modules serveur
   suivent les conventions établies, avec une organisation par fonctionnalité, accessible aux contributeurs.
5. **Tests obligatoires.** Tests unitaires et tests end-to-end, exécutés à chaque CI ; une PR qui
   les casse ne peut pas être fusionnée.
6. **Mise à jour automatique des règles des pays**, pensée pour quelqu'un qui n'y connaît rien en
   fiscalité ni en YAML (voir 4.1).
7. **Internationalisation complète** : plusieurs langues d'interface dès la V1, aucun texte en dur.
8. **Installation guidée au premier lancement**, à la manière de WordPress ou Drupal (voir P01).
9. **Sécurité au meilleur niveau et responsive parfait** sur téléphone, tablette et ordinateur.

## 2. Utilisateurs cibles

| Persona | Pays                  | Statut type                                                     | Particularités qui influencent le design                                                                                                |
| ------- | --------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Léa     | France                | Micro-entrepreneur (BNC)                                        | CA déclaré à l'encaissement ; déclarations mensuelles ou trimestrielles ; franchise de TVA ; CFE ; ACRE la 1re année ; Factur-X à venir |
| Jonas   | Allemagne             | Freiberufler, Kleinunternehmer                                  | Seuils sur l'année précédente et l'année en cours ; E-Rechnung (XRechnung/ZUGFeRD)                                                      |
| Mike    | États-Unis            | Sole proprietor                                                 | Estimated taxes à 4 dates inégalement espacées ; impôt fédéral + État ; formulaires 1099 reçus des clients                              |
| Emma    | Royaume-Uni           | Sole trader                                                     | **Année fiscale du 6 avril au 5 avril** ; Self Assessment ; payments on account ; seuil de VAT glissant sur 12 mois                     |
| Karim   | France                | Micro-entrepreneur qui dépasse le seuil de TVA en cours d'année | Bascule de régime en cours d'année                                                                                                      |
| Sofia   | Espagne (pas de pack) | Autónoma                                                        | Utilise Almanach sans pack pays, en mode générique                                                                                      |

Les règles citées servent à dimensionner l'architecture. Chaque pack pays est vérifié contre les
sources officielles ; chaque règle porte sa source et sa date de vérification.

## 3. Périmètre

### 3.1 Version 1

Profil et entreprise, clients, missions, saisie du temps, devis, factures et avoirs, paiements,
calendrier des échéances, rappels (e-mail, ntfy, iCal), tableau de bord avec seuils et estimations,
packs FR (vérifié) et DE, US, UK (expérimentaux), interface FR/EN/DE, export et import complets.

### 3.2 Versions suivantes

Facturation électronique (Factur-X, ZUGFeRD, XRechnung, plateformes agréées), relances automatiques,
rapprochement bancaire (CAMT.053, OFX, CSV), dépenses et justificatifs, taux de change BCE (optionnel),
multi-utilisateurs (comptable en lecture seule), packs communautaires (BE, CH, ES, IT, CA…), PWA hors ligne.

### 3.3 Hors périmètre

Version hébergée ou payante ; télédéclaration auprès des administrations ; comptabilité en partie
double complète ; paie et salariés.

## 4. Architecture des packs pays

Un pack pays fournit :

| Élément                    | Exemple FR                                      | Exemple UK                           |
| -------------------------- | ----------------------------------------------- | ------------------------------------ |
| Statuts proposés           | micro-entrepreneur BNC, BIC vente, BIC services | sole trader                          |
| Année fiscale              | 1er janvier – 31 décembre                       | 6 avril – 5 avril                    |
| Identifiants légaux        | SIRET, n° TVA                                   | UTR, n° VAT                          |
| Base du chiffre d'affaires | encaissé                                        | selon le régime                      |
| Calendrier d'obligations   | déclaration URSSAF, CFE                         | Self Assessment, payments on account |
| Formules d'estimation      | cotisations = CA × taux (réduit si ACRE)        | impôt estimé par tranches            |
| Seuils surveillés          | franchise TVA, plafond micro                    | seuil VAT sur 12 mois glissants      |
| Mentions de facture        | art. 293 B, autoliquidation, art. 259-1         | n° VAT, mentions HMRC                |
| Jours fériés               | fériés nationaux FR                             | bank holidays (par nation du UK)     |
| Règle de report            | échéance un jour non ouvré → jour ouvré suivant | idem                                 |
| Facture électronique       | Factur-X                                        | —                                    |

**Règles en données, pas en code** : taux, seuils et dates dans des fichiers YAML par année
(`packs/fr/2026.yaml`), chaque valeur avec `source` et `verified_on`. La logique propre à un pays est
une fonction TypeScript pure, testée unitairement. Chaque pack a un niveau de maturité :
`expérimental`, `communauté`, `vérifié`.

### 4.1 Mise à jour automatique des règles

Objectif : que les règles restent justes sans que personne n'ait à éditer du YAML à la main.

**Côté projet (mainteneurs et contributeurs)**

- Un robot planifié (GitHub Actions) surveille les pages officielles citées en `source` de chaque
  règle. Quand une page change, il ouvre un ticket qui montre la règle concernée, l'ancien et le
  nouvel extrait de la page.
- Les modifications se font par un **formulaire guidé** (une règle, sa nouvelle valeur, sa source,
  la date d'effet) qui génère le YAML et ouvre la PR ; aucune connaissance du format n'est requise.
- Chaque PR de règles passe : validation par schéma, tests du pack (cas réels attendus), aperçu
  lisible des changements (« le seuil de franchise passe de X à Y au 1er janvier »).
- Une nouvelle année se prépare en dupliquant l'année précédente : seules les valeurs qui changent sont à saisir.

**Côté instance (utilisateurs)**

- Les packs sont publiés comme des versions **signées** ; l'instance vérifie la signature et le
  schéma avant tout import, et refuse un pack invalide ou non signé.
- Vérification des mises à jour **désactivée par défaut** (aucun appel réseau non demandé),
  activable en un clic. Import manuel d'un fichier de pack possible pour les instances hors ligne.
- Avant d'appliquer : résumé en langage clair de ce qui change et de l'impact sur l'utilisateur.
- Application en un clic, **retour arrière** en un clic. Les factures émises ne changent jamais.

## 5. Internationalisation

- Interface en français, anglais et allemand en V1 ; traductions communautaires ensuite.
- Trois réglages indépendants : **langue de l'interface**, **pays fiscal**, **langue de chaque facture**.
- Formats localisés (`Intl`) : dates, nombres, devises, premier jour de la semaine, format 12 h ou 24 h.
- Montants stockés en **centimes entiers** avec leur devise ; jamais de flottants.
- Toutes les échéances sont calculées dans le **fuseau horaire de l'utilisateur**.
- Textes prévus pour l'allemand, en moyenne 30 % plus long que l'anglais : aucune largeur fixe sur les libellés.

---

## 6. Pages et écrans, avec leurs scénarios

### P01 — Installation au premier lancement (à la manière d'un CMS)

Assistant en étapes, protégé par un **jeton d'installation** affiché dans les logs du conteneur,
pour qu'un inconnu ne puisse pas s'approprier une instance fraîchement exposée sur Internet.

- **S-001** Étape 1, langue : choix de la langue de l'installation, détectée depuis le navigateur.
- **S-002** Étape 2, jeton : saisie du jeton d'installation lu dans les logs (`docker compose logs`), avec la commande affichée et un bouton pour la copier.
- **S-003** Étape 3, vérifications : base de données joignable, migrations applicables, secret de session non par défaut, HTTPS ou proxy de confiance, espace disque, fuseau horaire du serveur ; chaque point en vert, orange ou rouge, avec la correction à faire.
- **S-004** Étape 4, compte administrateur : e-mail, mot de passe avec indicateur de robustesse, proposition d'activer la double authentification tout de suite.
- **S-005** Étape 5, instance : nom, URL publique, fuseau horaire par défaut.
- **S-006** Étape 6, e-mail (facultatif) : configuration SMTP avec envoi de test, ou « plus tard ».
- **S-007** Étape 7, récapitulatif : puis redirection vers l'onboarding du profil (P03).
- **S-008** Point bloquant (base injoignable) : l'assistant reste sur l'étape et affiche la commande pour consulter les logs.
- **S-009** Installation déjà faite : l'assistant est définitivement inaccessible, redirection vers la connexion.
- **S-009b** Mise à jour de l'application nécessitant une migration : écran « mise à jour en cours », puis redirection.

### P02 — Connexion et sécurité du compte

- **S-010** Connexion par e-mail et mot de passe.
- **S-011** Mauvais mot de passe : message générique, sans indiquer si l'e-mail existe.
- **S-012** Trop de tentatives : blocage temporaire avec durée affichée.
- **S-013** Double authentification TOTP activée : seconde étape de saisie du code.
- **S-014** Perte de l'appareil TOTP : connexion avec un code de récupération.
- **S-015** Mot de passe oublié avec SMTP configuré : lien de réinitialisation par e-mail.
- **S-016** Mot de passe oublié sans SMTP : instructions pour réinitialiser en ligne de commande sur le serveur.
- **S-017** Connexion OIDC (Authentik, Keycloak…) si configurée : bouton dédié.
- **S-018** Session expirée pendant la saisie d'une facture : le brouillon est conservé et l'utilisateur revient à sa page après reconnexion.

### P03 — Configuration initiale du profil (onboarding)

- **S-020** Choix du pays fiscal parmi les packs disponibles, avec leur niveau de maturité visible.
- **S-021** Pays sans pack (Sofia, Espagne) : mode générique, sans échéances fiscales automatiques, avec des échéances personnalisées et une invitation à contribuer un pack.
- **S-022** Pack en statut `expérimental` : avertissement explicite avant validation.
- **S-023** Choix du statut proposé par le pack (ex. FR : BNC, BIC vente, BIC services).
- **S-024** Saisie de la date de début d'activité : elle détermine les exonérations et réductions de 1re année (ex. ACRE, CFE en FR).
- **S-025** Choix de la périodicité de déclaration quand le pack le permet (ex. FR : mensuelle ou trimestrielle).
- **S-026** Options fiscales du pack (ex. FR : versement libératoire de l'impôt sur le revenu).
- **S-027** Identifiants légaux, avec validation du format propre au pays (SIRET à 14 chiffres, n° TVA UE, EIN, UTR…).
- **S-028** Devise principale (préremplie selon le pays, modifiable).
- **S-029** Coordonnées bancaires : IBAN/BIC (Europe), sort code (UK), routing/account (US).
- **S-030** Logo et coordonnées de l'entreprise, avec aperçu en direct d'une facture.
- **S-031** Import des clients depuis un CSV dès l'onboarding (facultatif).
- **S-032** L'utilisateur quitte l'onboarding en cours : il reprend à l'étape où il s'était arrêté.
- **S-033** L'utilisateur déjà en activité depuis des mois saisit son CA déjà encaissé dans l'année, pour que seuils et estimations soient justes.

### P04 — Tableau de bord

- **S-040** Vue d'ensemble : CA du mois, du trimestre et de l'année fiscale (facturé et encaissé), prochaines échéances, factures en retard.
- **S-041** Instance neuve sans données : état vide qui guide vers « créer un client », « créer une facture ».
- **S-042** Échéance dans moins de 7 jours : carte mise en avant.
- **S-043** Échéance dépassée et non marquée comme faite : alerte rouge persistante.
- **S-044** Jauges de seuils : pourcentage atteint, montant restant, projection de la date de dépassement au rythme actuel.
- **S-045** Seuil dépassé : bannière qui explique les conséquences et les démarches, avec la source officielle.
- **S-046** Estimation des cotisations et impôts à provisionner, avec la formule détaillée au survol.
- **S-047** CA encaissé dans plusieurs devises : total converti dans la devise principale, avec le taux utilisé.
- **S-048** Année fiscale UK (avril-avril) : les cumuls suivent l'année fiscale et non l'année civile.
- **S-049** Pack de l'année suivante pas encore publié : bannière « règles 2027 non disponibles, estimations basées sur 2026 ».
- **S-050** Filtre par période (mois, trimestre, année, personnalisé) et comparaison avec la période précédente.

### P05 — Calendrier des échéances

- **S-060** Vues mois, semaine, liste et agenda.
- **S-061** Types d'échéances avec couleur et icône : fiscale et sociale (pack pays), mission, facture à encaisser, personnalisée.
- **S-062** Échéance tombant un week-end ou un jour férié : date reportée selon la règle du pack, avec indication « reportée du … ».
- **S-063** Création d'une échéance personnalisée, ponctuelle ou récurrente (ex. renouvellement d'assurance).
- **S-064** Marquer une échéance comme faite, avec une date et une note (ex. « déclaré le 28, n° de référence … »).
- **S-065** Annuler le marquage « faite ».
- **S-066** Masquer une échéance qui ne concerne pas l'utilisateur (ex. option non choisie).
- **S-067** Filtrer par type d'échéance.
- **S-068** Abonnement iCal : URL secrète à copier, bouton pour régénérer le lien s'il a fuité.
- **S-069** Changement de périodicité (mensuelle → trimestrielle) : les échéances futures sont recalculées, les passées restent.
- **S-070** Année fiscale terminée : les échéances passées restent consultables en historique.

### P06 — Détail d'une échéance

- **S-080** Description de l'obligation, période concernée (ex. « CA d'octobre 2026 »), montant à déclarer prérempli à partir des encaissements.
- **S-081** Lien vers le site officiel où faire la démarche, et source de la règle avec sa date de vérification.
- **S-082** Montant estimé à payer, avec le détail du calcul.
- **S-083** Montant déclaré différent de l'estimation : l'utilisateur saisit le montant réel, qui remplace l'estimation dans les statistiques.
- **S-084** Rappels de cette échéance : liste des rappels envoyés et à venir, possibilité de les modifier.
- **S-085** Pièce jointe (accusé de dépôt en PDF).

### P07 — Liste des clients

- **S-090** Liste avec recherche, tri (nom, CA, dernière facture) et filtres (pays, particulier ou entreprise, actif ou archivé).
- **S-091** État vide : bouton de création et bouton d'import CSV.
- **S-092** Import CSV : correspondance des colonnes, aperçu, rapport des lignes rejetées.
- **S-093** Doublon détecté à la création (même nom ou même n° TVA) : avertissement.
- **S-094** Archivage d'un client : il disparaît des listes de sélection mais ses factures restent.
- **S-095** Suppression impossible pour un client qui a des factures émises : seul l'archivage est proposé.

### P08 — Fiche client

- **S-100** Informations : type (particulier ou entreprise), pays, adresse, contacts, langue de facturation, devise, conditions de paiement par défaut.
- **S-101** Client entreprise de l'UE : saisie du n° TVA intracommunautaire, avec validation du format.
- **S-102** Client entreprise de l'UE sans n° TVA : avertissement, l'autoliquidation ne peut pas s'appliquer.
- **S-103** Client hors UE : mention de TVA adaptée proposée automatiquement par le pack.
- **S-104** Client dans le même pays : mentions nationales standard.
- **S-105** Historique : missions, devis, factures, paiements, CA total et délai moyen de paiement.
- **S-106** Plusieurs contacts, avec un contact de facturation distinct.
- **S-107** Notes libres.
- **S-108** Demande RGPD du client : export de ses données, ou anonymisation quand les obligations de conservation des factures le permettent.

### P09 — Liste des missions

- **S-110** Vues liste et tableau par statut (prospect, en cours, terminée, annulée).
- **S-111** Filtres par client, type de tarification, période.
- **S-112** Mission qui se termine bientôt : badge.
- **S-113** Mission terminée mais pas entièrement facturée : badge « reste à facturer ».
- **S-114** État vide.

### P10 — Fiche mission

- **S-120** Types de tarification : forfait, taux journalier, taux horaire, abonnement mensuel (maintenance).
- **S-121** Jalons avec date et montant, chacun facturable séparément.
- **S-122** Budget consommé : temps passé ou jalons facturés comparés au budget.
- **S-123** Dépassement du budget : alerte.
- **S-124** Abonnement mensuel : génération automatique d'un brouillon de facture chaque mois.
- **S-125** Mission sous-traitée pour une agence : le client est l'agence, avec un champ « client final » facultatif.
- **S-126** Mission dans une devise différente de la devise principale.
- **S-127** Clôture de la mission : récapitulatif temps passé, montant facturé, montant encaissé.

### P11 — Saisie du temps

- **S-130** Saisie manuelle d'une durée, en heures ou en jours selon la mission.
- **S-131** Minuteur démarrer / arrêter, qui survit à la fermeture de l'onglet.
- **S-132** Vue hebdomadaire en grille, missions en lignes, jours en colonnes.
- **S-133** Temps marqué comme facturé une fois intégré à une facture, puis verrouillé.
- **S-134** Temps non facturable (réunion offerte, correction de bug sous garantie).
- **S-135** Oubli : minuteur actif depuis plus de 10 heures, proposition de corriger la durée.

### P12 — Devis

- **S-140** Création d'un devis depuis un client ou une mission.
- **S-141** Date de validité, avec statut « expiré » automatique après cette date.
- **S-142** Statuts : brouillon, envoyé, accepté, refusé, expiré.
- **S-143** Conversion d'un devis accepté en facture ou en facture d'acompte.
- **S-144** Duplication d'un devis.
- **S-145** Mentions légales du devis fournies par le pack.

### P13 — Liste des factures

- **S-150** Liste filtrable par statut (brouillon, émise, payée, partiellement payée, en retard, annulée), client, période, devise.
- **S-151** Totaux en bas de liste : facturé, encaissé, restant dû, convertis dans la devise principale.
- **S-152** Facture en retard : badge avec nombre de jours de retard.
- **S-153** Actions groupées : export PDF en archive, export CSV.
- **S-154** État vide.

### P14 — Éditeur de facture

- **S-160** Sélection du client : langue, devise, conditions de paiement et mentions préremplies.
- **S-161** Lignes libres, lignes issues du temps saisi, ou lignes issues des jalons d'une mission.
- **S-162** Quantité, unité (heure, jour, forfait, mois), prix unitaire, remise par ligne ou globale.
- **S-163** Aperçu PDF en direct, dans la langue du client.
- **S-164** TVA : non applicable en franchise, autoliquidation, ou taux national, selon le pack, le statut et le client.
- **S-165** Facture d'acompte, puis facture de solde qui déduit l'acompte.
- **S-166** Date d'émission antérieure à la dernière facture émise : bloquée, la numérotation doit rester chronologique.
- **S-167** Date d'échéance calculée à partir des conditions de paiement (30 jours, fin de mois…).
- **S-168** Mentions de pénalités de retard et d'indemnité forfaitaire quand le pack les impose (ex. FR entre professionnels).
- **S-169** Note libre en pied de facture.
- **S-170** Enregistrement automatique du brouillon.
- **S-171** Émission : le numéro définitif est attribué, la facture devient non modifiable, confirmation explicite avant.
- **S-172** Erreur sur une facture émise : seul un avoir est proposé, jamais la modification ni la suppression.
- **S-173** Seuil de TVA dépassé (Karim) : l'éditeur passe automatiquement aux mentions et taux applicables à partir de la date de bascule.
- **S-174** Champ obligatoire manquant (SIRET non renseigné, adresse client absente) : émission bloquée avec la liste de ce qui manque.

### P15 — Aperçu et envoi d'une facture

- **S-180** Téléchargement du PDF.
- **S-181** Envoi par e-mail via le SMTP configuré, avec un modèle de message dans la langue du client.
- **S-182** SMTP non configuré : le bouton d'envoi explique comment le configurer, et le téléchargement reste disponible.
- **S-183** Échec d'envoi : erreur affichée, la facture reste à l'état « émise, non envoyée ».
- **S-184** Marquer comme envoyée manuellement (envoyée depuis une autre messagerie ou une plateforme client).
- **S-185** Lien de paiement libre ajouté au message (ex. lien d'un prestataire de paiement de l'utilisateur), sans intégration native.

### P16 — Paiements

- **S-190** Enregistrement d'un paiement : date, montant, moyen, référence.
- **S-191** Paiement partiel : statut « partiellement payée » et restant dû.
- **S-192** Paiement supérieur au montant dû : avertissement, trop-perçu enregistré.
- **S-193** Paiement en devise étrangère : montant reçu dans la devise principale saisi ou converti, différence de change visible.
- **S-194** Frais bancaires retenus par un intermédiaire : la facture est soldée, les frais notés à part.
- **S-195** La date d'encaissement détermine le mois de déclaration quand le pack déclare à l'encaissement (FR micro).
- **S-196** Suppression d'un paiement saisi par erreur, avec recalcul des statistiques.

### P17 — Avoirs

- **S-200** Avoir total ou partiel lié à une facture émise.
- **S-201** Numérotation des avoirs selon les règles du pack.
- **S-202** Avoir sur une facture déjà payée : remboursement à enregistrer, impact sur le CA de la période du remboursement.

### P18 — Seuils et estimations

- **S-210** Liste des seuils du pack, avec valeur, période de référence et progression.
- **S-211** Seuil calculé sur l'année précédente et l'année en cours (DE) : les deux jauges affichées.
- **S-212** Seuil sur 12 mois glissants (UK) : graphique de la fenêtre glissante.
- **S-213** Simulation : « si j'encaisse X € de plus ce mois-ci » met à jour jauges et estimations.
- **S-214** Estimation annuelle des cotisations et de l'impôt, mois par mois.
- **S-215** Réductions temporaires (ex. ACRE) : période de validité affichée, et bascule automatique au taux normal à la date de fin.
- **S-216** Montant réellement payé saisi sur une échéance : l'écart avec l'estimation est affiché.

### P19 — Centre de notifications

- **S-220** Liste des notifications de l'application : échéances, factures en retard, seuils, erreurs d'envoi, mise à jour disponible.
- **S-221** Marquer comme lu, tout marquer comme lu.
- **S-222** Notification de mise à jour d'un pack pays (nouvelle année publiée, règle corrigée).

### P20 — Paramètres

**Entreprise** — **S-230** Modifier les informations légales ; les factures déjà émises gardent les anciennes.

**Changement de situation**

- **S-231** Changement de statut en cours d'année : date d'effet, nouvelles échéances à partir de cette date.
- **S-232** Déménagement dans un autre pays : nouveau pack à partir d'une date d'effet, l'historique reste sous l'ancien pack.
- **S-233** Cessation d'activité : dernières échéances calculées, puis passage en lecture seule.

**Facturation**

- **S-234** Format de numérotation (préfixe, année, compteur), avec aperçu ; modifiable seulement pour la prochaine année ou avant la première facture.
- **S-235** Modèle de PDF : logo, couleur d'accent, police, choix parmi quelques mises en page.
- **S-236** Conditions de paiement et mentions par défaut.

**Notifications**

- **S-237** Configuration SMTP avec bouton « envoyer un e-mail de test ».
- **S-238** Configuration ntfy (serveur, sujet, jeton) avec bouton de test.
- **S-239** Délais de rappel par type d'échéance (J-14, J-7, J-1, le jour même).
- **S-240** Heures silencieuses : aucun push la nuit.

**Langue et région**

- **S-241** Langue de l'interface, fuseau horaire, format de date, premier jour de la semaine.

**Sécurité**

- **S-242** Changer le mot de passe, activer ou désactiver le TOTP, voir et révoquer les sessions actives.

**Packs pays et mises à jour des règles**

- **S-243** Pack actif, version, maturité, date de dernière vérification, liste des règles avec leurs sources.
- **S-244** Signaler une règle erronée : lien vers le gestionnaire de tickets du projet, avec la règle pré-remplie.
- **S-244a** Activer ou désactiver la vérification automatique des mises à jour de packs (désactivée par défaut).
- **S-244b** Mise à jour disponible : résumé en langage clair (« le taux de cotisation passe de X % à Y % au 1er janvier ; vos estimations 2027 changent »), puis « Appliquer » ou « Plus tard ».
- **S-244c** Signature ou schéma invalide : pack refusé, avec explication et rien de modifié.
- **S-244d** Retour à la version précédente d'un pack en un clic, avec historique des versions appliquées.
- **S-244e** Import manuel d'un fichier de pack signé, pour une instance sans accès Internet.

**Données**

- **S-245** Export complet (JSON, CSV, archive des PDF).
- **S-246** Import d'un export dans une instance neuve.
- **S-247** Import depuis un autre outil (CSV au format documenté).
- **S-248** Instructions de sauvegarde PostgreSQL, et date de la dernière sauvegarde si le script fourni est utilisé.
- **S-249** Suppression complète du compte, avec rappel des obligations légales de conservation des factures.

### P21 — Recherche globale

- **S-260** Raccourci clavier (Ctrl/Cmd + K) : recherche dans clients, missions, factures, échéances.
- **S-261** Recherche par numéro de facture exact.
- **S-262** Actions rapides depuis la recherche (« nouvelle facture pour… »).

### P22 — Pages système

- **S-270** Page 404.
- **S-271** Erreur serveur, avec identifiant d'erreur à copier pour un ticket.
- **S-272** Mode maintenance pendant une migration.
- **S-273** Nouvelle version disponible : bandeau avec lien vers les notes de version (vérification désactivable, aucune requête si désactivée).

---

## 7. Scénarios transverses

### Parcours complets par persona

- **S-300** Léa (FR) : onboarding en micro BNC → client allemand avec n° TVA → facture en anglais avec autoliquidation → paiement reçu le 3 novembre → le CA apparaît dans la déclaration de novembre → rappel J-7 → déclaration marquée comme faite.
- **S-301** Jonas (DE) : interface en allemand → facture en allemand avec mention Kleinunternehmer → jauge sur l'année précédente et l'année en cours.
- **S-302** Mike (US) : facture en USD à un client américain → échéances d'estimated taxes (dates inégalement espacées) → estimation de self-employment tax.
- **S-303** Emma (UK) : année fiscale avril-avril → Self Assessment au 31 janvier et payments on account → seuil de VAT sur 12 mois glissants.
- **S-304** Karim (FR) : dépasse le seuil de franchise de TVA en cours d'année → alerte → date de bascule → les factures suivantes portent la TVA → nouvelles échéances de déclaration de TVA.
- **S-305** Sofia (ES, sans pack) : mode générique → factures sans mentions automatiques → échéances personnalisées récurrentes.

### Multi-devises

- **S-310** Facture en USD, paiement reçu en EUR après conversion par la banque.
- **S-311** Taux de change manuel par défaut ; taux BCE automatique seulement si l'utilisateur l'active.
- **S-312** Statistiques toujours dans la devise principale, avec le taux utilisé visible.

### Dates et temps

- **S-320** Échéance un jour férié national, ou un jour férié propre à une région (bank holidays différents en Écosse).
- **S-321** Passage à l'heure d'été : les rappels partent à la bonne heure locale.
- **S-322** Changement de fuseau horaire (déplacement) : les échéances restent attachées à la date légale du pays fiscal.
- **S-323** Changement d'année fiscale : compteurs remis à zéro, numérotation qui repart si le format inclut l'année.
- **S-324** Règles d'une année non encore publiées dans le pack : estimations sur la dernière année connue, clairement signalées.

### Rappels

- **S-330** SMTP en panne : le rappel apparaît quand même dans l'application et dans le flux iCal ; nouvelle tentative plus tard.
- **S-331** Serveur éteint au moment d'un rappel : envoi au redémarrage si l'échéance n'est pas passée, sinon notification de retard.
- **S-332** Échéance marquée comme faite : les rappels suivants sont annulés.

### Mises à jour et données

- **S-340** Mise à jour de l'application : migrations automatiques, sauvegarde recommandée avant, notes de version visibles.
- **S-341** Correction d'une règle dans un pack : les estimations changent, les factures émises jamais.
- **S-342** Export depuis la version N, import dans la version N+1.

### Mobile et accessibilité

- **S-350** Toutes les pages utilisables sur téléphone : tableau de bord, calendrier, saisie d'un paiement, minuteur.
- **S-351** Navigation complète au clavier, lecteur d'écran, contrastes WCAG AA.
- **S-352** Thème clair et sombre, qui suit le système par défaut.
- **S-353** Respect de la préférence « réduire les animations ».

---

## 8. États communs à toutes les pages

Chaque page doit être maquettée dans ces états :

| État                           | Contenu attendu                                                      |
| ------------------------------ | -------------------------------------------------------------------- |
| Chargement                     | squelettes, jamais un écran blanc                                    |
| Vide                           | explication et action principale                                     |
| Erreur de chargement           | message et bouton « réessayer »                                      |
| Données partielles             | ce qui est disponible, avec indication de ce qui manque              |
| Lecture seule                  | activité cessée, ou facture émise                                    |
| Formulaire invalide            | erreurs sous chaque champ, résumé en haut pour les longs formulaires |
| Modifications non enregistrées | confirmation avant de quitter la page                                |
| Action destructive             | confirmation explicite, avec ce qui sera perdu                       |
| Hors ligne                     | bandeau, aucune perte de saisie                                      |

## 9. Exigences techniques

| Domaine           | Choix                                                               |
| ----------------- | ------------------------------------------------------------------- |
| Interface         | React + Vite + TypeScript, composants accessibles (WCAG AA)         |
| Serveur           | Node.js ou Bun, TypeScript, Hono                                    |
| Base de données   | PostgreSQL, Drizzle, migrations versionnées                         |
| Tâches planifiées | ordonnanceur interne au serveur, idempotent (clés de dédoublonnage) |
| PDF               | génération côté serveur ; PDF/A-3 plus tard pour Factur-X           |
| Authentification  | comptes locaux (argon2id), TOTP en option, OIDC en option           |
| Déploiement       | image Docker multi-arch (amd64, arm64), `docker-compose.yml` fourni |
| Configuration     | variables d'environnement documentées, aucun secret par défaut      |
| Tests             | unitaires (packs pays en priorité), API, end-to-end (Playwright)    |
| CI                | GitHub Actions : lint, tests, build de l'image                      |

### Sécurité

- **Serveur souverain** : chaque requête revalidée par schéma strict (Zod) ; aucun montant, total,
  taux, numéro de facture ou statut n'est accepté du client ; autorisation vérifiée sur chaque ressource.
- Mots de passe argon2id ; sessions côté serveur, cookies `HttpOnly`, `Secure`, `SameSite=Lax` ;
  protection CSRF ; limitation des tentatives par compte et par IP ; TOTP et codes de récupération.
- En-têtes stricts : CSP sans `unsafe-inline`, HSTS, `X-Content-Type-Options`, `Referrer-Policy`,
  `Permissions-Policy`, `frame-ancestors 'none'`.
- Requêtes SQL paramétrées uniquement (via l'ORM) ; fichiers téléversés (logo, pièces jointes) vérifiés
  par type réel et taille, stockés hors de la racine web ; PDF générés sans exécution de contenu utilisateur.
- Secrets uniquement par variables d'environnement ; image Docker minimale, sans root.
- Packs pays signés et vérifiés avant import.
- Journal d'audit (connexions, émissions de factures, changements de paramètres sensibles).
- Données personnelles : aucune donnée ne quitte l'instance sans action explicite ; export et anonymisation RGPD.

### Qualité et CI

- TypeScript en mode strict ; Biome (lint et format) ; aucune fonction sans son bloc de commentaire en anglais.
- Tests unitaires (`bun test`) : packs pays en priorité, calculs, validation, autorisations.
- Tests end-to-end (Playwright) : parcours S-300 à S-305, installation P01, sur Chromium, Firefox et
  WebKit, en tailles téléphone, tablette et ordinateur.
- Tests d'accessibilité automatisés (axe) dans les tests end-to-end.
- CI à chaque PR : lint, types, tests unitaires, tests end-to-end, audit des dépendances, analyse
  statique de sécurité, build de l'image. Fusion bloquée si une étape échoue.

### Responsive

- Conception mobile d'abord ; points de rupture téléphone, tablette, ordinateur.
- Navigation latérale sur ordinateur, barre d'onglets en bas sur téléphone.
- Tableaux larges transformés en listes de cartes sur téléphone, ou défilement horizontal dans leur cadre.
- Cibles tactiles d'au moins 44 px ; aucun contenu accessible uniquement au survol.

## 10. Critères d'acceptation de la V1

1. Une installation neuve via `docker compose up -d` aboutit à un compte fonctionnel en moins de 5 minutes.
2. Les parcours S-300 à S-305 fonctionnent de bout en bout, couverts par des tests end-to-end en CI.
   - Une mise à jour de pack signée s'applique et se retire en un clic ; un pack non signé est refusé.
3. Le flux iCal s'abonne dans Google Agenda, Apple Calendar et Thunderbird.
4. Un export complet réimporté dans une instance neuve restitue les mêmes données.
5. Chaque page existe dans les états de la section 8.
6. Le pack FR est `vérifié` ; les packs DE, US et UK peuvent être `expérimentaux`.

## 11. Feuille de route

| Étape | Contenu                                                           |
| ----- | ----------------------------------------------------------------- |
| 0     | Repo, licence, CI, docker compose, squelette interface et serveur |
| 1     | Onboarding, profil, clients, missions                             |
| 2     | Devis, factures, avoirs, paiements, PDF, pack FR                  |
| 3     | Calendrier, rappels, iCal, tableau de bord, seuils                |
| 4     | Saisie du temps, i18n EN et DE, packs DE, US, UK                  |
| 5     | Export et import, recherche, documentation, publication 1.0       |

## 12. Questions ouvertes

- Nom de domaine : almanach.dev, almanach.app ou almanach.chteau.bzh.
- Génération Factur-X en JavaScript, ou petit service dédié (Rust ou Go) pour le PDF/A-3.
- Support de SQLite en plus de PostgreSQL pour les très petites installations.
- Gouvernance des packs pays : qui peut marquer un pack comme `vérifié`.
- Multi-entreprises dans une même instance (un indépendant avec deux activités).
