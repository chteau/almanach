CREATE TABLE "pack_bundles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country" text NOT NULL,
	"sequence" integer NOT NULL,
	"key_id" text NOT NULL,
	"payload" text NOT NULL,
	"signature" text NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"installed_by" uuid,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pack_bundles" ADD CONSTRAINT "pack_bundles_installed_by_users_id_fk" FOREIGN KEY ("installed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pack_bundles_country_sequence_idx" ON "pack_bundles" USING btree ("country","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "pack_bundles_active_idx" ON "pack_bundles" USING btree ("country") WHERE "pack_bundles"."active";