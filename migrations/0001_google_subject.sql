-- Google sign-in must bind to the verified provider subject, not an unverified
-- local email. Existing accounts intentionally remain unlinked (NULL).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "google_subject" varchar(255);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_google_subject_unique" ON "users" ("google_subject");
