import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 200 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  walletBalance: integer("wallet_balance").notNull().default(0),
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
    provider: varchar("provider", { length: 40 }).notNull().default("simulated"),
    providerRequestId: varchar("provider_request_id", { length: 160 }),
    referenceCode: text("reference_code"),
    otpCode: varchar("otp_code", { length: 12 }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    refundedAt: timestamp("refunded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("orders_user_idx").on(table.userId)],
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

export type User = typeof users.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type WalletTransaction = typeof walletTransactions.$inferSelect;
export type ContactMessage = typeof contactMessages.$inferSelect;
export type GiftCard = typeof giftCards.$inferSelect;
export type ScheduledOrder = typeof scheduledOrders.$inferSelect;
