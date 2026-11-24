ALTER TABLE "billing_settings" ADD COLUMN "facturx_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "address_lines" jsonb;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "einvoice_format" text;--> statement-breakpoint
-- Prudent split of the free-text address, kept as it is: only a last line "<5 digits> <city>" (France, Germany)
-- after at least one street line is recognised; any other address keeps all its lines and no postal code nor city.
WITH parts AS (
  SELECT "id", "country", array_remove(regexp_split_to_array(btrim("address"), '\s*\n\s*'), '') AS "lines"
  FROM "clients"
  WHERE "address" IS NOT NULL AND btrim("address") <> ''
), parsed AS (
  SELECT "id", "lines",
    CASE WHEN cardinality("lines") >= 2 AND "country" IN ('FR', 'DE')
      THEN regexp_match("lines"[cardinality("lines")], '^(?:D-)?(\d{5})\s+(\S.*)$') END AS "m"
  FROM parts
)
UPDATE "clients" AS c
SET "address_lines" = to_jsonb(CASE WHEN p."m" IS NULL THEN p."lines" ELSE p."lines"[1:cardinality(p."lines") - 1] END),
    "postal_code" = p."m"[1],
    "city" = p."m"[2]
FROM parsed AS p
WHERE c."id" = p."id";
