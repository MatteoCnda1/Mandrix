ALTER TABLE "comments" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "photo_media_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "pinned_post_id" uuid;