CREATE TABLE "guess_rounds" (
	"user_id" uuid NOT NULL,
	"reveal_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guess_rounds_user_id_reveal_at_pk" PRIMARY KEY("user_id","reveal_at")
);
--> statement-breakpoint
CREATE TABLE "shot_guesses" (
	"user_id" uuid NOT NULL,
	"shot_id" uuid NOT NULL,
	"guessed_id" uuid,
	"correct" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shot_guesses_user_id_shot_id_pk" PRIMARY KEY("user_id","shot_id")
);
--> statement-breakpoint
CREATE TABLE "whois_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guess_rounds" ADD CONSTRAINT "guess_rounds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_guesses" ADD CONSTRAINT "shot_guesses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_guesses" ADD CONSTRAINT "shot_guesses_shot_id_shots_id_fk" FOREIGN KEY ("shot_id") REFERENCES "public"."shots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shot_guesses" ADD CONSTRAINT "shot_guesses_guessed_id_users_id_fk" FOREIGN KEY ("guessed_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whois_questions" ADD CONSTRAINT "whois_questions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guess_rounds_created_idx" ON "guess_rounds" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "whois_questions_author_idx" ON "whois_questions" USING btree ("author_id");