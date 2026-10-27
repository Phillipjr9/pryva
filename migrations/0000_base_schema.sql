CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"bank_name" varchar(100) NOT NULL,
	"bank_code" varchar(20) NOT NULL,
	"account_number" varchar(20) NOT NULL,
	"account_name" varchar(200) NOT NULL,
	"recipient_code" varchar(100),
	"is_default" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"name" varchar(120) NOT NULL,
	"email" varchar(200) NOT NULL,
	"topic" varchar(80) NOT NULL,
	"message" text NOT NULL,
	"status" varchar(24) DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gift_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(20) NOT NULL,
	"amount" integer NOT NULL,
	"initial_amount" integer NOT NULL,
	"purchased_by" uuid NOT NULL,
	"redeemed_by" uuid,
	"recipient_email" varchar(200),
	"message" text,
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"redeemed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_cards_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"message" text NOT NULL,
	"type" varchar(40) DEFAULT 'info' NOT NULL,
	"read" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(32) NOT NULL,
	"user_id" uuid NOT NULL,
	"service" varchar(40) NOT NULL,
	"product_slug" varchar(80) NOT NULL,
	"product_name" varchar(160) NOT NULL,
	"plan_label" varchar(120) NOT NULL,
	"region" varchar(80) NOT NULL,
	"duration" varchar(80) NOT NULL,
	"amount" integer NOT NULL,
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"provider" varchar(40) DEFAULT 'simulated' NOT NULL,
	"provider_request_id" varchar(160),
	"reference_code" text,
	"otp_code" varchar(12),
	"accounts" text,
	"expires_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "payment_topups" (
	"reference" varchar(40) PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"service" varchar(40) NOT NULL,
	"product_slug" varchar(80) NOT NULL,
	"frequency" varchar(24) NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_order_id" uuid,
	"status" varchar(24) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_violations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"user_email" varchar(200),
	"type" varchar(40) NOT NULL,
	"details" text NOT NULL,
	"ip" varchar(45),
	"url" varchar(500),
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" varchar(128) NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"email" varchar(200) NOT NULL,
	"password_hash" text NOT NULL,
	"wallet_balance" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"order_id" uuid,
	"type" varchar(24) NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"description" varchar(200) NOT NULL,
	"reference" varchar(40) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdrawals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"fee" integer DEFAULT 0 NOT NULL,
	"bank_name" varchar(100) NOT NULL,
	"account_number" varchar(20) NOT NULL,
	"account_name" varchar(200) NOT NULL,
	"recipient_code" varchar(100),
	"status" varchar(24) DEFAULT 'pending' NOT NULL,
	"reference" varchar(50) NOT NULL,
	"transfer_reference" varchar(100),
	"failure_reason" text,
	"processed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "withdrawals_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_purchased_by_users_id_fk" FOREIGN KEY ("purchased_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_redeemed_by_users_id_fk" FOREIGN KEY ("redeemed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_topups" ADD CONSTRAINT "payment_topups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_orders" ADD CONSTRAINT "scheduled_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_orders" ADD CONSTRAINT "scheduled_orders_last_order_id_orders_id_fk" FOREIGN KEY ("last_order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_violations" ADD CONSTRAINT "security_violations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawals" ADD CONSTRAINT "withdrawals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_accounts_user_idx" ON "bank_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "gift_cards_code_idx" ON "gift_cards" USING btree ("code");--> statement-breakpoint
CREATE INDEX "gift_cards_status_idx" ON "gift_cards" USING btree ("status");--> statement-breakpoint
CREATE INDEX "gift_cards_purchased_by_idx" ON "gift_cards" USING btree ("purchased_by");--> statement-breakpoint
CREATE INDEX "gift_cards_redeemed_by_idx" ON "gift_cards" USING btree ("redeemed_by");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_read_idx" ON "notifications" USING btree ("read");--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "payment_topups_user_idx" ON "payment_topups" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "scheduled_orders_user_idx" ON "scheduled_orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "scheduled_orders_next_run_idx" ON "scheduled_orders" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "scheduled_orders_status_idx" ON "scheduled_orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "security_violations_user_idx" ON "security_violations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "security_violations_type_idx" ON "security_violations" USING btree ("type");--> statement-breakpoint
CREATE INDEX "security_violations_created_idx" ON "security_violations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "wallet_user_idx" ON "wallet_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "withdrawals_user_idx" ON "withdrawals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "withdrawals_status_idx" ON "withdrawals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "withdrawals_reference_idx" ON "withdrawals" USING btree ("reference");