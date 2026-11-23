CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"stripe_key" text,
	"stripe_sync" boolean DEFAULT false NOT NULL,
	"stripe_synced_at" timestamp with time zone,
	"stripe_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "external_revenues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"date" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"received_cents" bigint,
	"client" text,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "instance" ADD COLUMN "stripe_sync" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "external_revenues" ADD CONSTRAINT "external_revenues_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "companies_user_idx" ON "companies" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "external_revenues_source_idx" ON "external_revenues" USING btree ("company_id","source","external_id");
--> statement-breakpoint
CREATE INDEX "external_revenues_company_date_idx" ON "external_revenues" USING btree ("company_id","date");
--> statement-breakpoint
-- Every existing account gets a first company with the same id, so existing rows keep their owner value.
INSERT INTO "companies" ("id", "user_id", "name", "created_at") SELECT "users"."id", "users"."id", COALESCE(NULLIF("profiles"."company"->>'name', ''), split_part("users"."email", '@', 1)), "users"."created_at" FROM "users" LEFT JOIN "profiles" ON "profiles"."user_id" = "users"."id";
--> statement-breakpoint
ALTER TABLE "profiles" DROP CONSTRAINT "profiles_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "profiles" RENAME COLUMN "user_id" TO "company_id";
--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "onboarding_drafts" DROP CONSTRAINT "onboarding_drafts_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "onboarding_drafts" RENAME COLUMN "user_id" TO "company_id";
--> statement-breakpoint
ALTER TABLE "onboarding_drafts" ADD CONSTRAINT "onboarding_drafts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "clients" DROP CONSTRAINT "clients_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "clients" RENAME COLUMN "user_id" TO "company_id";
--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "missions" DROP CONSTRAINT "missions_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "missions" RENAME COLUMN "user_id" TO "company_id";
--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "documents" RENAME COLUMN "user_id" TO "company_id";
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "number_sequences" DROP CONSTRAINT "number_sequences_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "number_sequences" RENAME COLUMN "user_id" TO "company_id";
--> statement-breakpoint
ALTER TABLE "number_sequences" ADD CONSTRAINT "number_sequences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "payments" RENAME COLUMN "user_id" TO "company_id";
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "deadline_marks" DROP CONSTRAINT "deadline_marks_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "deadline_marks" RENAME COLUMN "user_id" TO "company_id";
--> statement-breakpoint
ALTER TABLE "deadline_marks" ADD CONSTRAINT "deadline_marks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "custom_deadlines" DROP CONSTRAINT "custom_deadlines_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "custom_deadlines" RENAME COLUMN "user_id" TO "company_id";
--> statement-breakpoint
ALTER TABLE "custom_deadlines" ADD CONSTRAINT "custom_deadlines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "notifications" RENAME COLUMN "user_id" TO "company_id";
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "time_entries" DROP CONSTRAINT "time_entries_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "time_entries" RENAME COLUMN "user_id" TO "company_id";
--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "billing_settings" DROP CONSTRAINT "billing_settings_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "billing_settings" RENAME COLUMN "user_id" TO "company_id";
--> statement-breakpoint
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "situation_changes" DROP CONSTRAINT "situation_changes_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "situation_changes" RENAME COLUMN "user_id" TO "company_id";
--> statement-breakpoint
ALTER TABLE "situation_changes" ADD CONSTRAINT "situation_changes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "number_sequences" RENAME CONSTRAINT "number_sequences_user_id_family_year_pk" TO "number_sequences_company_id_family_year_pk";
--> statement-breakpoint
ALTER TABLE "deadline_marks" RENAME CONSTRAINT "deadline_marks_user_id_key_pk" TO "deadline_marks_company_id_key_pk";