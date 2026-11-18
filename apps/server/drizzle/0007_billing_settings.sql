CREATE TABLE "billing_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"numbering" jsonb NOT NULL,
	"pdf" jsonb NOT NULL,
	"default_terms_days" integer DEFAULT 30 NOT NULL,
	"default_note" text,
	"logo" text,
	"logo_mime" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;