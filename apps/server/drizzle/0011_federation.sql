CREATE TABLE "federation_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"state" text NOT NULL,
	"code_hash" text,
	"code_expires_at" timestamp with time zone,
	"peer_url" text,
	"public_key" text,
	"private_key" text,
	"peer_public_key" text,
	"peer_key_id" text,
	"share" boolean DEFAULT true NOT NULL,
	"receive" boolean DEFAULT true NOT NULL,
	"pulls" boolean DEFAULT false NOT NULL,
	"peer_label" text,
	"peer_currency" text,
	"synced_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "federation_nonces" (
	"key_id" text NOT NULL,
	"nonce" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "federation_nonces_key_id_nonce_pk" PRIMARY KEY("key_id","nonce")
);
--> statement-breakpoint
CREATE TABLE "federation_totals" (
	"link_id" uuid NOT NULL,
	"month" text NOT NULL,
	"category" text NOT NULL,
	"cents" bigint NOT NULL,
	CONSTRAINT "federation_totals_link_id_month_category_pk" PRIMARY KEY("link_id","month","category")
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "federation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "federation_label" text;--> statement-breakpoint
ALTER TABLE "instance" ADD COLUMN "federation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "federation_links" ADD CONSTRAINT "federation_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_totals" ADD CONSTRAINT "federation_totals_link_id_federation_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."federation_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "federation_links_company_idx" ON "federation_links" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "federation_links_peer_key_idx" ON "federation_links" USING btree ("peer_key_id");--> statement-breakpoint
CREATE UNIQUE INDEX "federation_links_code_idx" ON "federation_links" USING btree ("code_hash");