CREATE TABLE "deal_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"deal_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_stage" text,
	"to_stage" text,
	"note" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"activity_id" uuid,
	"client_id" uuid,
	"prospect_name" text,
	"prospect_contact" text,
	"title" text NOT NULL,
	"stage" text NOT NULL,
	"amount_cents" bigint,
	"currency" text,
	"quote_id" uuid,
	"mission_id" uuid,
	"next_action_on" date,
	"next_action" text,
	"lost_reason" text,
	"closed_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deals_quote_id_unique" UNIQUE("quote_id"),
	CONSTRAINT "deals_named" CHECK ("deals"."client_id" is not null or "deals"."prospect_name" is not null)
);
--> statement-breakpoint
CREATE TABLE "pipeline_settings" (
	"company_id" uuid PRIMARY KEY NOT NULL,
	"follow_up_days" integer DEFAULT 7 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deal_events" ADD CONSTRAINT "deal_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_events" ADD CONSTRAINT "deal_events_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_activity_id_company_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."company_activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_quote_id_documents_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pipeline_settings" ADD CONSTRAINT "pipeline_settings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_events_deal_idx" ON "deal_events" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "deals_company_stage_idx" ON "deals" USING btree ("company_id","stage");--> statement-breakpoint
CREATE INDEX "deals_company_next_idx" ON "deals" USING btree ("company_id","next_action_on");--> statement-breakpoint
-- Missions still at "prospect" become deals at the lead stage, linked to the mission; run twice, adds nothing.
INSERT INTO "deals" ("company_id", "client_id", "title", "stage", "amount_cents", "currency", "mission_id", "created_at", "updated_at")
SELECT m."company_id", m."client_id", m."name", 'lead', m."budget_cents", m."currency", m."id", m."created_at", now()
FROM "missions" m
WHERE m."status" = 'prospect' AND NOT EXISTS (SELECT 1 FROM "deals" d WHERE d."mission_id" = m."id");
