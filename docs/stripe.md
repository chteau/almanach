# Synchronisation Stripe

Almanach peut importer les **clients** Stripe comme clients d'une entreprise, et les paiements
encaissés par Stripe comme **recettes**, rattachées à leur client. Elles comptent dans le chiffre
d'affaires, les seuils et l'estimation des cotisations, comme les paiements de factures Almanach.

## Activer

1. Le serveur a besoin de `SECRETS_KEY` (32 octets en base64, `openssl rand -base64 32`) : la clé
   Stripe est stockée chiffrée (AES-256-GCM). Garde `SECRETS_KEY` avec tes sauvegardes.
2. Un administrateur autorise la synchronisation dans **Réglages → Instance**, ou l'administrateur du
   serveur pose `STRIPE_SYNC=true` dans sa configuration (la case s'affiche alors cochée et
   verrouillée, « autorisé par la configuration du serveur »). Tant que ce n'est pas fait, Almanach
   n'envoie aucune requête à Stripe.
3. Dans Stripe, crée une **clé restreinte** (`rk_live_…`) avec uniquement :
   - Charges : lecture ;
   - Customers : lecture ;
   - Invoices : lecture ;
   - Balance transactions : lecture ;
   - Refunds : lecture, si la ligne apparaît ;
   - tout le reste : aucun accès.
4. Dans **Réglages → Synchronisation Stripe** de l'entreprise, colle la clé, coche « Synchroniser
   toutes les 6 heures » et enregistre. « Synchroniser maintenant » lance un import immédiat.

Chaque entreprise a sa propre clé : un compte Stripe par structure.

## Ce qui est importé

| Objet Stripe | Recette |
|---|---|
| Facture payée | Montant payé hors taxes (`total_excluding_tax` au prorata), date de paiement, client, numéro de facture |
| Paiement sans facture | Montant encaissé, date, nom du client |
| Remboursement | Montant négatif, hors taxes au prorata de la facture d'origine |

- Les paiements dans une autre devise que celle de l'entreprise reprennent le montant converti par
  Stripe (balance transaction) quand le compte Stripe est réglé dans la devise de l'entreprise ;
  sinon ils sont signalés comme non convertis, comme les paiements de factures.
- Chaque objet est identifié par son identifiant Stripe : relancer la synchronisation n'importe
  jamais deux fois la même recette. Chaque passage relit les 60 derniers jours (factures payées
  tardivement) ; le premier remonte à la date de début d'activité.
- Les frais Stripe ne sont pas déduits : le chiffre d'affaires d'une micro-entreprise se compte
  en brut.
- Aucune donnée de carte n'est conservée : seulement montants, devises, dates, coordonnées du client
  et numéro de facture.

## Clients

Chaque client Stripe (`cus_…`) devient un client Almanach de l'entreprise : nom, e-mail, adresse
(lignes 1 et 2, code postal, ville, région), pays, numéro de TVA intracommunautaire (identifiant
fiscal `eu_vat`, lu par l'expansion `tax_ids`) et SIRET s'il figure dans les métadonnées (clé
`siret` ou `SIRET`). Les valeurs qu'Almanach refuserait dans le formulaire (TVA ou SIRET mal formés)
sont ignorées. Un client avec TVA ou SIRET est une entreprise, sinon un particulier ; devise,
langue et délai de paiement viennent du client Stripe ou des réglages de l'entreprise.

- **Idempotent** : l'identifiant Stripe est gardé sur le client ; chaque passage met ses champs à
  jour. Un client déjà saisi avec le même nom ou le même numéro de TVA est rattaché au lieu d'être
  dupliqué, et garde sa saisie.
- **Saisie manuelle protégée** : dès qu'un client venant de Stripe est enregistré dans Almanach, un
  indicateur (`stripe_edited`) est posé et la synchronisation ne touche plus ses champs. Pour
  repartir des données Stripe, supprimer le client (s'il n'a ni mission ni encaissement) et
  relancer la synchronisation.
- **Client supprimé dans Stripe** : il disparaît de la liste Stripe ; Almanach le marque seulement
  (« supprimé dans Stripe »), sans rien effacer, pour garder factures et encaissements. Changer de
  compte Stripe marque de même les clients de l'ancien compte.
- Chaque recette dont le paiement ou la facture a un `customer` est rattachée au client, et la fiche
  client liste ses encaissements. La mise à jour 0012 fait relire tout l'historique au passage
  suivant pour rattacher les recettes déjà importées.

L'API Stripe est appelée en version `2024-06-20`, figée pour que les formats ne changent pas.
