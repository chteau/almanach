# Facturation électronique (Factur-X)

Almanach produit des factures **Factur-X profil EN16931** : un PDF/A-3 lisible par un humain, qui embarque la
facture structurée `factur-x.xml` (syntaxe UN/CEFACT CII D16B, norme EN 16931). C'est l'un des trois formats du
socle de la réforme française (UBL, CII, Factur-X).

**Almanach ne transmet rien.** L'envoi par une plateforme agréée (France) ou par Peppol est hors périmètre :
télécharge le PDF + Factur-X et dépose-le sur la plateforme agréée de ton choix. La **réception** des factures
de tes fournisseurs (obligatoire en France depuis le 1er septembre 2026) n'est pas gérée non plus : utilise la
plateforme agréée de ton choix.

## Utiliser

- **Réglages → Facturation → Valeurs par défaut** : « PDF + Factur-X par défaut » coche l'option sur les
  nouvelles factures des clients professionnels.
- **Sur chaque facture, acompte ou avoir** : case « PDF + Factur-X ». L'éditeur liste ce qui manque pour une
  e-facture valide ; une facture sans l'option s'émet comme avant.
- Une fois la facture émise, le format est figé : le PDF téléchargé contient la Factur-X, régénérée à
  l'identique depuis les données figées à l'émission.
- Tous les PDF (devis et brouillons compris) sont désormais en PDF/A-3B : polices intégrées, profil sRGB.

## Données nécessaires

| Donnée | Terme EN 16931 | D'où elle vient |
| --- | --- | --- |
| Rue, code postal, ville, pays du client | BG-8, BT-55 | fiche client (adresse structurée) |
| Rue, code postal, ville du vendeur | BG-5, BT-40 | adresse du profil, dernière ligne « code postal ville » |
| SIREN du vendeur | BT-30 (schéma ISO 6523 `0002`) | 9 premiers chiffres du SIRET |
| SIREN du client français | BT-47 | SIRET de la fiche client, s'il est renseigné |
| N° de TVA du vendeur | BT-31 | profil ; exigé même en franchise (règle BR-E-02) |
| N° de TVA du client | BT-48 | fiche client ; exigé en autoliquidation (BR-AE-02) |
| Motif d'exonération | BT-120, BT-121 | mention légale existante du pack + code VATEX |

Les clients existants ont été migrés prudemment (migration `0024`) : seule une dernière ligne « 5 chiffres +
ville » (France, Allemagne) est reconnue comme code postal et ville ; tout le reste reste en lignes de rue, et le
texte libre d'origine est conservé.

Pas de Factur-X pour un client particulier (B2C relève de l'e-reporting, hors périmètre) ni dans une devise autre
que celle du pays (le montant de TVA en devise comptable, BT-111, n'est pas encore produit).

## Correspondances

- Régimes de TVA → catégories (UNTDID 5305) : taux national `S`, franchise `E`, autoliquidation intra-UE `AE`,
  prestation hors du champ (export) `O`.
- Codes VATEX (France) : franchise `VATEX-FR-FRANCHISE`, autoliquidation `VATEX-EU-AE`, export `VATEX-EU-O`,
  vérifiés le 2026-11-24 dans la liste CEF VATEX version 9 (en vigueur au 15/11/2026).
- Types : facture `380`, facture d'acompte `386`, avoir `381` (avec la facture d'origine, BG-3).
- Unités (UN/ECE Rec. 20) : heure `HUR`, jour `DAY`, mois `MON`, unité `C62`, forfait `LS`.
- Remise globale : remise document BG-20 (code 95) ; acomptes déduits : BT-113 ; paiement : virement SEPA (58).

## Maturité par pays

| Pays | `einvoicing` | Détail |
| --- | --- | --- |
| France | `verified` | Factur-X EN16931, validée par veraPDF et le Schematron CEN EN 16931 |
| Allemagne | `verified` | ZUGFeRD/Factur-X EN16931 (Steuernummer en BT-32, USt-IdNr. exigée : BR-CO-26), validée comme la France ; XRechnung non produit |
| Royaume-Uni, États-Unis | absent | aucune obligation B2B aujourd'hui |

Le modèle sémantique (`packages/shared/src/einvoice.ts`) est indépendant de la syntaxe : UBL / XRechnung pourra
s'y brancher (le schéma de pack accepte déjà le format `ubl`, non proposé).

## Validation

```sh
scripts/validate-einvoice.sh /tmp/einvoice   # télécharge et vérifie (SHA-256) les outils, puis valide
```

Le script génère des exemples français et allemands (franchise, TVA avec remises et acompte déduit, avoir,
autoliquidation intra-UE, devis brouillon classique) et les passe dans :

- **veraPDF 1.30.4**, profil PDF/A-3B ;
- **Schematron EN 16931 CII** du CEN TC 434 (artefacts de validation 1.3.17, XSLT officiel exécuté par Saxon) ;
- **Mustang 2.26.0** (`--action validate`), qui contrôle la Factur-X entière (PDF/A, XMP, XSD et règles).

La CI exécute le même script (job « Factur-X validation »). Les tests unitaires couvrent le modèle
(`einvoice.test.ts`), le XML et la structure PDF (`cii.test.ts`) et le parcours API complet avec PostgreSQL
(`einvoice.db.test.ts`).

## Ressources intégrées

- Polices **Geist** (Vercel) et **Liberation Serif** (Red Hat), SIL Open Font License 1.1 : licences dans
  `apps/server/assets/fonts/`.
- Profil **sRGB IEC61966-2.1** de colord (`sRGB.icc`), « libre de restrictions connues de droits d'auteur »
  (mention incluse dans le profil).

## Sources officielles

- Calendrier français : [impots.gouv.fr, « Je découvre la facturation électronique »](https://www.impots.gouv.fr/professionnel/je-decouvre-la-facturation-electronique),
  [dépliant DGFiP micro-entreprises](https://www.impots.gouv.fr/sites/default/files/media/1_metier/2_professionnel/EV/2_gestion/290_facturation_electronique/facturation-electronique---depliant-microentreprises.pdf),
  [economie.gouv.fr](https://www.economie.gouv.fr/tout-savoir-sur-la-facturation-electronique-pour-les-entreprises).
- Formats du socle : [norme AFNOR XP Z12-012 publiée par la DGFiP](https://www.impots.gouv.fr/sites/default/files/media/1_metier/2_professionnel/EV/2_gestion/290_facturation_electronique/specification_externes_b2b/afnor/norme-afnor-factures.pdf).
- Factur-X : [FNFE-MPE, spécification Factur-X](https://fnfe-mpe.org/factur-x/) (XMP `fx:`, `factur-x.xml`,
  `AFRelationship` `Data`).
- EN 16931, listes de codes et VATEX : [Commission européenne, registre des artefacts EN 16931](https://ec.europa.eu/digital-building-blocks/sites/display/DIGITAL/Registry+of+supporting+artefacts+to+implement+EN16931),
  [listes de codes](https://ec.europa.eu/digital-building-blocks/sites/display/DIGITAL/Code+lists).
- Règles de validation : [CEN TC 434, eInvoicing-EN16931 1.3.17](https://github.com/ConnectingEurope/eInvoicing-EN16931/releases/tag/validation-1.3.17).
- PDF/A : [veraPDF](https://verapdf.org) (ISO 19005-3) ; Factur-X complète : [Mustang](https://www.mustangproject.org).
- Allemagne : [BMF, FAQ E-Rechnung](https://www.bundesfinanzministerium.de/Content/DE/FAQ/e-rechnung.html).
