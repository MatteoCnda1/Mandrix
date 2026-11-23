ALTER TABLE "media" ADD COLUMN "status" text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "source_path" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "poster_path" text;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "duration" real;--> statement-breakpoint
ALTER TABLE "shots" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "shots" ADD COLUMN "on_time" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "media_status_idx" ON "media" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "shots_client_idx" ON "shots" USING btree ("user_id","client_id");