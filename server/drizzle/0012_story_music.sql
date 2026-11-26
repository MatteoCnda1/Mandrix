ALTER TABLE "stories" ADD COLUMN "music_media_id" uuid;--> statement-breakpoint
ALTER TABLE "stories" ADD COLUMN "music" jsonb;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_music_media_id_media_id_fk" FOREIGN KEY ("music_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;