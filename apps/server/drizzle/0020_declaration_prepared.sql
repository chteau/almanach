CREATE TABLE "deadline_notices" (
	"company_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"fiscal_year" integer NOT NULL,
	"per_occurrence_cents" bigint,
	"prior_year_tax_cents" bigint,
	"prior_year_income_cents" bigint,
	"method" text,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deadline_notices_company_id_rule_id_fiscal_year_pk" PRIMARY KEY("company_id","rule_id","fiscal_year")
);
--> statement-breakpoint
ALTER TABLE "deadline_marks" ADD COLUMN "declared" jsonb;--> statement-breakpoint
ALTER TABLE "deadline_notices" ADD CONSTRAINT "deadline_notices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;