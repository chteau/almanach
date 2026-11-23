ALTER TABLE "clients" ADD COLUMN "siret" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "stripe_id" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "stripe_edited" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "stripe_deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "external_revenues" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "external_revenues" ADD CONSTRAINT "external_revenues_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clients_stripe_idx" ON "clients" USING btree ("company_id","stripe_id");--> statement-breakpoint
-- Next Stripe sync reads everything again from the activity start, linking receipts imported before customers were.
UPDATE "companies" SET "stripe_synced_at" = NULL;
