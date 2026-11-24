CREATE TABLE "company_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"status" text NOT NULL,
	"link_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "custom_deadlines" ADD COLUMN "activity_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "activity_id" uuid;--> statement-breakpoint
ALTER TABLE "federation_links" ADD COLUMN "peer_activity" text;--> statement-breakpoint
ALTER TABLE "federation_links" ADD COLUMN "activity_auto" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "federation_links" ADD COLUMN "activity_main" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "federation_links" ADD COLUMN "activity_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "activity_id" uuid;--> statement-breakpoint
ALTER TABLE "company_activities" ADD CONSTRAINT "company_activities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_activities" ADD CONSTRAINT "company_activities_link_id_federation_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."federation_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_activities_status_idx" ON "company_activities" USING btree ("company_id","status");--> statement-breakpoint
ALTER TABLE "custom_deadlines" ADD CONSTRAINT "custom_deadlines_activity_id_company_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."company_activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_activity_id_company_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."company_activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_links" ADD CONSTRAINT "federation_links_activity_id_company_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."company_activities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_activity_id_company_activities_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."company_activities"("id") ON DELETE set null ON UPDATE no action;