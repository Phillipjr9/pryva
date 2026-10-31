import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  key: varchar("key", { length: 64 }).primaryKey(),
  count: integer("count").notNull(),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
}, (table) => [index("rate_limit_buckets_reset_at_idx").on(table.resetAt)]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 200 }).notNull().unique(),
  // Google identities are bound by their stable verified subject, never by email alone.
  googleSubject: varchar("google_subject", { length: 255 }).unique(),
  passwordHash: text("password_hash").notNull(),
  walletBalance: integer("wallet_balance").notNull().default(0),
  // NULL until the owner proves control of the address. Privilege that is granted
  // by matching this row's email (ADMIN_EMAILS) must not treat an unverified
  // address as the owner's: signup accepted any string.
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  // Consecutive wrong passwords. Reset on success, on lock, and on reset.
  // The lock is an instant rather than a flag so it expires without a job.
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    token: varchar("token", { length: 128 }).notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sessions_user_idx").on(table.userId)],
);

/**
 * Single-use password reset tokens.
 *
 * Only a SHA-256 hash of the token is stored: anyone who reads this table must
 * not be able to reset a password with what they find. A token is valid until it
 * is used or expires, and requesting a new one supersedes any outstanding token
 * for that account so only the most recent link works.
 */
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("password_reset_tokens_hash_idx").on(table.tokenHash),
    index("password_reset_tokens_user_idx").on(table.userId),
  ],
);

export const emailVerificationTokens = pgTable(
  "email_verification_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("email_verification_tokens_hash_idx").on(table.tokenHash),
    index("email_verification_tokens_user_idx").on(table.userId),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    reference: varchar("reference", { length: 32 }).notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    service: varchar("service", { length: 40 }).notNull(),
    productSlug: varchar("product_slug", { length: 80 }).notNull(),
    productName: varchar("product_name", { length: 160 }).notNull(),
    planLabel: varchar("plan_label", { length: 120 }).notNull(),
    region: varchar("region", { length: 80 }).notNull(),
    duration: varchar("duration", { length: 80 }).notNull(),
    amount: integer("amount").notNull(),
    status: varchar("status", { length: 24 }).notNull().default("active"),
    /**
     * Which provider fulfilled this order, and therefore which one has to be
     * asked to release the unit on a refund.
     *
     * No default, deliberately. A default of "simulated" -- demo language left
     * over in a production column -- meant any insert path that forgot to name a
     * provider silently recorded a supplier that does not exist, and
     * cancelUpstream would then match nothing and quietly fail to release the
     * unit. A missing provider is now a database error instead of a plausible
     * looking wrong answer.
     */
    provider: varchar("provider", { length: 40 }).notNull(),
    providerRequestId: varchar("provider_request_id", { length: 160 }),
    referenceCode: text("reference_code"),
    otpCode: varchar("otp_code", { length: 12 }),
    /** JSON array of delivered credential strings (marketplace accounts only). */
    accounts: text("accounts"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    /**
     * Set when a refund committed but the provider unit could not be released:
     * the money is back with the customer and the number may still be working,
     * so an owner has to finish it by hand.
     */
    reconciliationNote: text("reconciliation_note"),
    /**
     * What this unit actually cost us, in naira.
     *
     * The provider's charged amount where it reports one, otherwise the price it
     * quoted before we bought. Persisted because the cost sheet is a planning
     * document, not a source of truth: real margin per plan and per destination
     * can only be measured from what suppliers actually charged. Never shown to
     * customers -- it is wholesale cost.
     */
    providerCostNgn: integer("provider_cost_ngn"),
    // Optional for legacy rows; every new purchase supplies a per-user key that
    // makes a retried request replay the original order instead of buying a
    // second number and debiting twice.
    requestId: uuid("request_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("orders_user_idx").on(table.userId),
    uniqueIndex("orders_user_request_idx").on(table.userId, table.requestId),
  ],
);

export const walletTransactions = pgTable(
  "wallet_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    type: varchar("type", { length: 24 }).notNull(),
    amount: integer("amount").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    description: varchar("description", { length: 200 }).notNull(),
    reference: varchar("reference", { length: 40 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("wallet_user_idx").on(table.userId)],
);

// A server-created top-up is required before a signed Paystack event can
// credit a wallet. The reference is unique, so retries are idempotent.
export const paymentTopups = pgTable(
  "payment_topups",
  {
    reference: varchar("reference", { length: 40 }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    status: varchar("status", { length: 24 }).notNull().default("pending"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /**
     * The account holder's name at the moment this deposit settled, frozen
     * thereafter. Withdrawals may only be paid to a bank account whose resolved
     * name matches it — see src/lib/withdrawal-name-check.ts.
     *
     * Deliberately not `users.name`, which the profile endpoint edits at any
     * time: a reference that can be changed after the money arrives cannot prove
     * who sent it. NULL for deposits that settled before migration 0012, and a
     * NULL fails the payout check closed rather than being treated as a match.
     */
    payerName: varchar("payer_name", { length: 120 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("payment_topups_user_idx").on(table.userId)],
);

// Inserted by PostgreSQL triggers alongside wallet ledger/status changes. The
// Resend worker claims rows with a lease; provider calls happen after commit.
export const walletEmailOutbox = pgTable("wallet_email_outbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  walletTransactionId: uuid("wallet_transaction_id").references(() => walletTransactions.id, { onDelete: "cascade" }),
  withdrawalId: uuid("withdrawal_id").references(() => withdrawals.id, { onDelete: "cascade" }),
  orderId: uuid("order_id").references(() => orders.id, { onDelete: "cascade" }),
  eventKind: varchar("event_kind", { length: 40 }).notNull(),
  recipient: varchar("recipient", { length: 200 }).notNull(),
  payload: text("payload"),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  lockToken: uuid("lock_token"),
  firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true }),
  providerMessageId: varchar("provider_message_id", { length: 100 }),
  lastError: varchar("last_error", { length: 80 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("wallet_email_outbox_transaction_idx").on(table.walletTransactionId),
  uniqueIndex("wallet_email_outbox_withdrawal_event_idx").on(table.withdrawalId, table.eventKind),
  uniqueIndex("wallet_email_outbox_order_event_idx").on(table.orderId, table.eventKind),
  index("wallet_email_outbox_due_idx").on(table.status, table.availableAt),
]);

export const contactMessages = pgTable("contact_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 200 }).notNull(),
  topic: varchar("topic", { length: 80 }).notNull(),
  message: text("message").notNull(),
  status: varchar("status", { length: 24 }).notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const giftCards = pgTable(
  "gift_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: varchar("code", { length: 20 }).notNull().unique(),
    amount: integer("amount").notNull(),
    initialAmount: integer("initial_amount").notNull(),
    purchasedBy: uuid("purchased_by")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    redeemedBy: uuid("redeemed_by").references(() => users.id, { onDelete: "set null" }),
    recipientEmail: varchar("recipient_email", { length: 200 }),
    message: text("message"),
    status: varchar("status", { length: 24 }).notNull().default("active"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("gift_cards_code_idx").on(table.code),
    index("gift_cards_status_idx").on(table.status),
    index("gift_cards_purchased_by_idx").on(table.purchasedBy),
    index("gift_cards_redeemed_by_idx").on(table.redeemedBy),
  ],
);

export const scheduledOrders = pgTable(
  "scheduled_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    service: varchar("service", { length: 40 }).notNull(),
    productSlug: varchar("product_slug", { length: 80 }).notNull(),
    frequency: varchar("frequency", { length: 24 }).notNull(),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastOrderId: uuid("last_order_id").references(() => orders.id, { onDelete: "set null" }),
    status: varchar("status", { length: 24 }).notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("scheduled_orders_user_idx").on(table.userId),
    index("scheduled_orders_next_run_idx").on(table.nextRunAt),
    index("scheduled_orders_status_idx").on(table.status),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 200 }).notNull(),
    message: text("message").notNull(),
    type: varchar("type", { length: 40 }).notNull().default("info"),
    read: integer("read").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("notifications_user_idx").on(table.userId),
    index("notifications_read_idx").on(table.read),
  ],
);

export const securityViolations = pgTable(
  "security_violations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    userEmail: varchar("user_email", { length: 200 }),
    type: varchar("type", { length: 40 }).notNull(),
    details: text("details").notNull(),
    ip: varchar("ip", { length: 45 }),
    url: varchar("url", { length: 500 }),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("security_violations_user_idx").on(table.userId),
    index("security_violations_type_idx").on(table.type),
    index("security_violations_created_idx").on(table.createdAt),
  ],
);

export const withdrawals = pgTable(
  "withdrawals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    fee: integer("fee").notNull().default(0),
    bankName: varchar("bank_name", { length: 100 }).notNull(),
    accountNumber: varchar("account_number", { length: 20 }).notNull(),
    accountName: varchar("account_name", { length: 200 }).notNull(),
    recipientCode: varchar("recipient_code", { length: 100 }),
    status: varchar("status", { length: 24 }).notNull().default("pending"),
    reference: varchar("reference", { length: 50 }).notNull().unique(),
    // Optional for legacy rows; all new customer requests supply a per-user key.
    requestId: uuid("request_id"),
    // Snapshot of the selected bank-account id, retained even if it is removed.
    bankAccountId: uuid("bank_account_id"),
    // The provider reference is saved before initiation; transferReference is
    // Paystack's returned transfer code. Legacy processing rows remain NULL.
    paystackReference: varchar("paystack_reference", { length: 50 }),
    transferReference: varchar("transfer_reference", { length: 100 }),
    failureReason: text("failure_reason"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("withdrawals_user_idx").on(table.userId),
    index("withdrawals_status_idx").on(table.status),
    index("withdrawals_reference_idx").on(table.reference),
    uniqueIndex("withdrawals_user_request_idx").on(table.userId, table.requestId),
    uniqueIndex("withdrawals_paystack_reference_idx").on(table.paystackReference),
  ],
);

export const bankAccounts = pgTable(
  "bank_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bankName: varchar("bank_name", { length: 100 }).notNull(),
    bankCode: varchar("bank_code", { length: 20 }).notNull(),
    accountNumber: varchar("account_number", { length: 20 }).notNull(),
    accountName: varchar("account_name", { length: 200 }).notNull(),
    recipientCode: varchar("recipient_code", { length: 100 }),
    isDefault: integer("is_default").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("bank_accounts_user_idx").on(table.userId),
  ],
);

/**
 * A disposable inbox.
 *
 * The free tier is the one thing Pryva gives away, and it is built to be
 * outgrown: one inbox a day, read while it is alive, nothing retained. The paid
 * tier sells volume and history rather than time, because the supplier sets an
 * inbox's own lifetime and sells no duration -- which is what made four
 * duration-based tiers undeliverable when they were tried.
 *
 * Two limits are partial unique indexes rather than application checks, because
 * both are decided by two requests arriving at once and buying an inbox spends
 * real money the moment it is created. See migration 0013.
 */
export const disposableInboxes = pgTable(
  "disposable_inboxes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Which source supplied it, so a stranded inbox can still be cancelled. */
    provider: varchar("provider", { length: 32 }).notNull(),
    /** The provider's own handle; polling and cancelling both need it. */
    providerInboxId: varchar("provider_inbox_id", { length: 191 }).notNull(),
    address: varchar("address", { length: 320 }).notNull(),
    domain: varchar("domain", { length: 255 }),
    /** `free` | `paid`. Decides which limits apply and whether messages are kept. */
    tier: varchar("tier", { length: 16 }).notNull().default("free"),
    /**
     * The order that paid for a paid inbox. Free inboxes move no money and leave
     * this NULL: recording them as orders would put zero-revenue rows into margin
     * analytics and would need an order status that means "nothing was sold".
     */
    orderId: uuid("order_id").references(() => orders.id, { onDelete: "set null" }),
    /** `active` | `discarded` | `expired` | `failed` */
    status: varchar("status", { length: 24 }).notNull().default("active"),
    /**
     * `<userId>:<yyyy-mm-dd>` for free inboxes, NULL for paid ones. The unique
     * index on it is what makes "one free inbox per day" survive two concurrent
     * requests, and scoping it by NULL keeps it from colliding across tiers.
     */
    dailyKey: varchar("daily_key", { length: 80 }),
    /**
     * The provider's own expiry, when it reports one. We may end an inbox sooner;
     * nothing can make one live longer than the supplier allows.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    discardedAt: timestamp("discarded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Scoped to the free tier on purpose: a paid bundle is several concurrent
    // inboxes, so a blanket one-active-inbox index would make it unsellable.
    uniqueIndex("disposable_inboxes_one_active_free_per_user")
      .on(table.userId)
      .where(sql`${table.status} = 'active' AND ${table.tier} = 'free'`),
    uniqueIndex("disposable_inboxes_free_daily_key")
      .on(table.dailyKey)
      .where(sql`${table.dailyKey} IS NOT NULL`),
    index("disposable_inboxes_user_idx").on(table.userId),
  ],
);

/**
 * A message that arrived in an inbox.
 *
 * Retained for paid inboxes -- that retention is the product. Polling re-reads
 * the whole mailbox and the provider gives its messages no identity, so
 * `fingerprint` hashes the parts that do distinguish one from another and the
 * unique index makes a repeated poll insert nothing. Without it every refresh
 * would duplicate the mailbox.
 */
export const inboxMessages = pgTable(
  "inbox_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inboxId: uuid("inbox_id")
      .notNull()
      .references(() => disposableInboxes.id, { onDelete: "cascade" }),
    /** Denormalised so a customer's messages can be listed and deleted with them. */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    subject: text("subject"),
    fromAddress: text("from_address"),
    body: text("body"),
    /** The parsed verification code, when the provider recognised one. */
    code: varchar("code", { length: 64 }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("inbox_messages_once_per_inbox").on(table.inboxId, table.fingerprint),
    index("inbox_messages_inbox_idx").on(table.inboxId),
    index("inbox_messages_user_idx").on(table.userId),
  ],
);

export type User = typeof users.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type WalletTransaction = typeof walletTransactions.$inferSelect;
export type ContactMessage = typeof contactMessages.$inferSelect;
/**
 * A review of an order that was actually delivered.
 *
 * `orderId` is unique in the migration, so one purchase yields at most one
 * review. `service` and `productName` are copied from the order rather than
 * joined, so delisting a product cannot silently detach or rewrite a published
 * review. Nothing is public until `status` becomes 'published'.
 */
export const productReviews = pgTable(
  "product_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    service: varchar("service", { length: 40 }).notNull(),
    productName: varchar("product_name", { length: 160 }).notNull(),
    rating: integer("rating").notNull(),
    headline: varchar("headline", { length: 80 }),
    body: text("body").notNull(),
    status: varchar("status", { length: 16 }).notNull().default("pending"),
    moderatorNote: text("moderator_note"),
    moderatedBy: uuid("moderated_by").references(() => users.id, { onDelete: "set null" }),
    moderatedAt: timestamp("moderated_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("product_reviews_order_id_key").on(table.orderId),
    index("product_reviews_status_created_idx").on(table.status, table.createdAt),
    index("product_reviews_user_idx").on(table.userId),
  ],
);

export type GiftCard = typeof giftCards.$inferSelect;
export type ScheduledOrder = typeof scheduledOrders.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type SecurityViolation = typeof securityViolations.$inferSelect;
export type Withdrawal = typeof withdrawals.$inferSelect;
export type BankAccount = typeof bankAccounts.$inferSelect;
export type DisposableInbox = typeof disposableInboxes.$inferSelect;
export type InboxMessage = typeof inboxMessages.$inferSelect;
export type ProductReview = typeof productReviews.$inferSelect;

/**
 * Who did what in the admin console, and to whom.
 *
 * Every privileged mutation that moves money or changes an account writes one
 * row here. It is deliberately append-only: nothing in the app updates or
 * deletes an entry, and there is no route that exposes one to a customer.
 *
 * `actor_email` is snapshotted rather than joined. An email is the identity a
 * human recognises in a dispute, and the account it came from may be renamed or
 * removed later; the ledger has to keep saying what was true when the action ran.
 *
 * The entry is a *record*, not the source of truth: the wallet ledger remains
 * authoritative for money. A failed insert is logged loudly and does not roll
 * back an action that already moved funds -- see `src/lib/admin-audit.ts` for why
 * that trade was chosen and what it costs.
 */
/**
 * One row per business day: the nightly close, and the evidence that it ran.
 *
 * `status` starts at 'running' and is updated when the sweep finishes, so a
 * crashed run leaves a visible row instead of no trace. `totals` is a report
 * (jsonb) — nothing joins to it; the money stays in the tables that constrain it.
 */
export const reconciliationRuns = pgTable(
  "reconciliation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    day: date("day").notNull().unique(),
    status: varchar("status", { length: 16 }).notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    accountsChecked: integer("accounts_checked").notNull().default(0),
    discrepancies: integer("discrepancies").notNull().default(0),
    totals: jsonb("totals"),
    notes: text("notes"),
  },
  (table) => [index("reconciliation_runs_started_idx").on(table.startedAt)],
);

export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** NULL only if the acting account is later deleted (deletion is not offered yet). */
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    actorEmail: varchar("actor_email", { length: 200 }).notNull(),
    /** Dotted verbs such as `withdrawal.approve`, so filters stay stable. */
    action: varchar("action", { length: 64 }).notNull(),
    /** `order` | `withdrawal` | `user` | `message` | `gift_card`. */
    targetType: varchar("target_type", { length: 32 }).notNull(),
    /** An id or reference. Not a foreign key: targets live in several tables. */
    targetId: varchar("target_id", { length: 191 }).notNull(),
    /** Human-readable, already redacted. Never credentials, codes or full account numbers. */
    summary: text("summary").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("admin_audit_log_created_idx").on(table.createdAt),
    index("admin_audit_log_actor_idx").on(table.actorId),
    index("admin_audit_log_target_idx").on(table.targetType, table.targetId),
  ],
);

export type AdminAuditEntry = typeof adminAuditLog.$inferSelect;

/**
 * A user's TOTP enrolment. `enabledAt` NULL means an enrolment was started and
 * abandoned; sign-in only demands a code once it is set.
 *
 * The secret is encrypted here, never stored as issued: a database dump must not
 * hand over the second factor. See `src/lib/two-factor.ts`.
 */
export const userTwoFactor = pgTable("user_two_factor", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  secretCiphertext: text("secret_ciphertext").notNull(),
  enabledAt: timestamp("enabled_at", { withTimezone: true }),
  /**
   * The last TOTP time-step accepted, so a code cannot be replayed within its
   * own validity window. BIGINT because a step is seconds since the epoch / 30.
   */
  lastUsedStep: bigint("last_used_step", { mode: "number" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One-way hashes of the ten single-use recovery codes. Plaintext is shown once. */
export const twoFactorRecoveryCodes = pgTable(
  "two_factor_recovery_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: varchar("code_hash", { length: 64 }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("two_factor_recovery_codes_hash_idx").on(table.userId, table.codeHash),
    index("two_factor_recovery_codes_user_idx").on(table.userId),
  ],
);

/** Short-lived sign-in challenge. Only the SHA-256 of the token is stored. */
export const twoFactorChallenges = pgTable(
  "two_factor_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("two_factor_challenges_user_idx").on(table.userId),
    index("two_factor_challenges_expires_idx").on(table.expiresAt),
  ],
);

/**
 * A support conversation, not a support form submission.
 *
 * `contact_messages` is the public form: anonymous, one-way, no thread. A
 * customer with a problem needs the other shape — a thread they can add to, that
 * can be answered by the assistant or by a person, and whose state is visible to
 * both sides. That is this table.
 *
 * `status` drives who the ball is with:
 *   open               the customer wrote, nobody has answered yet
 *   waiting_on_customer the assistant asked a question and needs an answer
 *   escalated          a person has to look; the assistant says why in the thread
 *   resolved           answered or fixed; the customer can still reply
 *   closed             read-only
 *
 * `handled_by` records who finished it (assistant | admin), because "the AI
 * resolved 40% of tickets" should be a measured claim, not a hope.
 */
export const supportTickets = pgTable(
  "support_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subject: varchar("subject", { length: 160 }).notNull(),
    category: varchar("category", { length: 40 }).notNull().default("other"),
    status: varchar("status", { length: 24 }).notNull().default("open"),
    priority: varchar("priority", { length: 16 }).notNull().default("normal"),
    channel: varchar("channel", { length: 16 }).notNull().default("dashboard"),
    handledBy: varchar("handled_by", { length: 16 }),
    assignedAdminId: uuid("assigned_admin_id").references(() => users.id, { onDelete: "set null" }),
    /**
     * The assistant's own confidence in its last decision, 0-100.
     *
     * Stored so an operator can sort by "least sure first" instead of reading
     * every thread, and so the claim "it escalated rather than guessed" can be
     * checked after the fact.
     */
    assistantConfidence: integer("assistant_confidence"),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("support_tickets_user_idx").on(table.userId),
    index("support_tickets_status_idx").on(table.status),
    index("support_tickets_activity_idx").on(table.lastActivityAt),
  ],
);

/**
 * One message in a ticket thread.
 *
 * `trace` holds the assistant's reasoning for its own messages: the evidence it
 * read, the options it scored, what it ran and whether the fix verified. It is
 * deliberately *not* shown to the customer (the reply is), and it is the reason
 * an escalated ticket does not start the operator from zero.
 */
export const supportMessages = pgTable(
  "support_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => supportTickets.id, { onDelete: "cascade" }),
    authorRole: varchar("author_role", { length: 16 }).notNull(),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    trace: text("trace"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("support_messages_ticket_idx").on(table.ticketId, table.createdAt)],
);

/**
 * A passkey: a WebAuthn credential the customer's own device holds the private
 * half of.
 *
 * The public key is stored as base64url COSE bytes in a text column rather than
 * `bytea`, because the value is not secret and every layer of this app — the
 * preview adapter included — handles strings without a driver-specific codec.
 *
 * `counter` is the authenticator's signature counter. A credential that reports
 * a number that has not moved forward has been cloned, and the WebAuthn library
 * refuses it; keeping the value is what makes that check possible on the next
 * sign-in.
 */
export const webauthnCredentials = pgTable(
  "webauthn_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** base64url credential id, exactly as the authenticator reports it. */
    credentialId: text("credential_id").notNull().unique(),
    /** base64url COSE public key. Public by definition — never a secret. */
    publicKey: text("public_key").notNull(),
    counter: integer("counter").notNull().default(0),
    /** Comma-separated transports the authenticator advertised ("internal,hybrid"). */
    transports: varchar("transports", { length: 120 }),
    /** "singleDevice" (this phone/laptop) or "multiDevice" (synced passkey). */
    deviceType: varchar("device_type", { length: 24 }),
    backedUp: boolean("backed_up").notNull().default(false),
    /** What the customer called it, so a list of three passkeys means something. */
    label: varchar("label", { length: 80 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [
    index("webauthn_credentials_user_idx").on(table.userId),
  ],
);

/**
 * The challenge a WebAuthn ceremony must sign.
 *
 * Server-side and single-use on purpose. A challenge the client picks, or one
 * that can be spent twice, turns a signature into a replayable token; consuming
 * this row with a conditional update is what makes an assertion good for exactly
 * one sign-in.
 *
 * `user_id` is NULL for the username-less sign-in flow, where the authenticator
 * names the account by returning its credential id.
 */
export const webauthnChallenges = pgTable(
  "webauthn_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    purpose: varchar("purpose", { length: 16 }).notNull(),
    challenge: text("challenge").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("webauthn_challenges_challenge_idx").on(table.challenge)],
);
