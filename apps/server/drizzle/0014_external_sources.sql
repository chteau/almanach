CREATE TABLE "external_clients" (
	"source_id" uuid NOT NULL,
	"remote_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "external_clients_source_id_remote_id_pk" PRIMARY KEY("source_id","remote_id")
);
--> statement-breakpoint
CREATE TABLE "external_documents" (
	"source_id" uuid NOT NULL,
	"remote_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "external_documents_source_id_remote_id_pk" PRIMARY KEY("source_id","remote_id")
);
--> statement-breakpoint
CREATE TABLE "external_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"token" text NOT NULL,
	"test" boolean DEFAULT false NOT NULL,
	"synced_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "livemode" boolean;--> statement-breakpoint
ALTER TABLE "external_revenues" ADD COLUMN "livemode" boolean;--> statement-breakpoint
ALTER TABLE "instance" ADD COLUMN "external_sources" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "external_clients" ADD CONSTRAINT "external_clients_source_id_external_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."external_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_documents" ADD CONSTRAINT "external_documents_source_id_external_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."external_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_sources" ADD CONSTRAINT "external_sources_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_sources_company_idx" ON "external_sources" USING btree ("company_id");