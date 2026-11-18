CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"state" text NOT NULL,
	"number" text,
	"client_id" uuid NOT NULL,
	"mission_id" uuid,
	"related_id" uuid,
	"issue_date" date NOT NULL,
	"due_date" date,
	"valid_until" date,
	"language" text NOT NULL,
	"currency" text NOT NULL,
	"lines" jsonb NOT NULL,
	"discount_bp" integer NOT NULL,
	"note" text,
	"deposit_ids" jsonb NOT NULL,
	"vat_mode" text NOT NULL,
	"mentions" jsonb NOT NULL,
	"totals" jsonb NOT NULL,
	"seller" jsonb,
	"buyer" jsonb,
	"sent_at" timestamp with time zone,
	"issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "number_sequences" (
	"user_id" uuid NOT NULL,
	"family" text NOT NULL,
	"year" integer NOT NULL,
	"last" integer NOT NULL,
	CONSTRAINT "number_sequences_user_id_family_year_pk" PRIMARY KEY("user_id","family","year")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"received_cents" bigint,
	"fees_cents" bigint NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_mission_id_missions_id_fk" FOREIGN KEY ("mission_id") REFERENCES "public"."missions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_sequences" ADD CONSTRAINT "number_sequences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_user_idx" ON "documents" USING btree ("user_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_number_unique" ON "documents" USING btree ("user_id","number");--> statement-breakpoint
CREATE INDEX "payments_document_idx" ON "payments" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "payments_user_date_idx" ON "payments" USING btree ("user_id","date");