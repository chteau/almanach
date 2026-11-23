CREATE TABLE "federation_clients" (
	"link_id" uuid NOT NULL,
	"remote_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "federation_clients_link_id_remote_id_pk" PRIMARY KEY("link_id","remote_id")
);
--> statement-breakpoint
CREATE TABLE "federation_documents" (
	"link_id" uuid NOT NULL,
	"remote_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "federation_documents_link_id_remote_id_pk" PRIMARY KEY("link_id","remote_id")
);
--> statement-breakpoint
CREATE TABLE "federation_payments" (
	"link_id" uuid NOT NULL,
	"remote_id" uuid NOT NULL,
	"data" jsonb NOT NULL,
	CONSTRAINT "federation_payments_link_id_remote_id_pk" PRIMARY KEY("link_id","remote_id")
);
--> statement-breakpoint
ALTER TABLE "federation_links" ADD COLUMN "share_detail" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "federation_links" ADD COLUMN "receive_detail" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "federation_links" ADD COLUMN "peer_receives_detail" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "federation_clients" ADD CONSTRAINT "federation_clients_link_id_federation_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."federation_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_documents" ADD CONSTRAINT "federation_documents_link_id_federation_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."federation_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "federation_payments" ADD CONSTRAINT "federation_payments_link_id_federation_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."federation_links"("id") ON DELETE cascade ON UPDATE no action;