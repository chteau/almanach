ALTER TABLE "instance" ADD COLUMN "pack_auto_check" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "instance" ADD COLUMN "version_check" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pack_bundles" ADD COLUMN "applied_at" timestamp with time zone;--> statement-breakpoint
UPDATE "pack_bundles" SET "applied_at" = "installed_at";
