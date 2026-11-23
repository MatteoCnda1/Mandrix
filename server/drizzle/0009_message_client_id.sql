ALTER TABLE "messages" ADD COLUMN "client_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_client_idx" ON "messages" USING btree ("sender_id","client_id");