CREATE TABLE "reserve_settings" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"margin_bp" integer,
	"extra_rate_bp" integer DEFAULT 0 NOT NULL,
	"extra_monthly_cents" bigint DEFAULT 0 NOT NULL,
	"extra_note" text,
	"tax_parts_quarters" integer DEFAULT 4 NOT NULL,
	"joint_taxation" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reserve_settings" ADD CONSTRAINT "reserve_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;