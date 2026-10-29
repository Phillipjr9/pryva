import { randomBytes, scryptSync } from "node:crypto";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { createAwsIamPool } from "@/db/aws-iam";
import {
  awsIamConfigured,
  persistentDatabaseConfigured,
} from "@/lib/database-config";
import { getOperators, getOrderByOperators } from "drizzle-orm";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL?.trim();

function toCamelCase(value: string): string {
  return value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function isDrizzleColumn(value: unknown): value is { name: string; table: unknown } {
  return (
    !!value &&
    typeof value === "object" &&
    "name" in value &&
    "table" in value &&
    typeof (value as { name?: unknown }).name === "string"
  );
}

function isDrizzleTable(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const drizzleBaseName = Symbol.for("drizzle:BaseName");
  return typeof (value as Record<PropertyKey, unknown>)[drizzleBaseName] === "string";
}

function tableNameFor(table: unknown): string {
  if (table && typeof table === "object") {
    const drizzleBaseName = Symbol.for("drizzle:BaseName");
    const baseName = (table as Record<PropertyKey, unknown>)[drizzleBaseName];
    if (typeof baseName === "string") return toCamelCase(baseName);
    const name = (table as { name?: string }).name;
    if (typeof name === "string") return toCamelCase(name);
  }
  return "unknown";
}

type FlatToken =
  | { kind: "col"; table: string; prop: string }
  | { kind: "op"; text: string }
  | { kind: "val"; value: unknown };

function flattenSqlChunks(node: unknown, out: FlatToken[] = []): FlatToken[] {
  if (node === null || node === undefined) return out;

  if (
    typeof node === "string" ||
    typeof node === "number" ||
    typeof node === "boolean" ||
    node instanceof Date
  ) {
    out.push({ kind: "val", value: node });
    return out;
  }

  // inArray() hands over a plain array of Param objects. Without this branch
  // the values vanished, leaving `col in` with no right-hand side — which the
  // clause evaluator below treats as "no constraint", so every row matched.
  if (Array.isArray(node)) {
    for (const entry of node) flattenSqlChunks(entry, out);
    return out;
  }

  if (isDrizzleColumn(node)) {
    out.push({
      kind: "col",
      table: tableNameFor(node.table),
      prop: toCamelCase(node.name),
    });
    return out;
  }

  if (typeof node === "object" && "queryChunks" in node) {
    const chunks = (node as { queryChunks?: unknown[] }).queryChunks ?? [];
    for (const chunk of chunks) {
      flattenSqlChunks(chunk, out);
    }
    return out;
  }

  if (typeof node === "object" && "value" in node) {
    const rawVal = (node as { value?: unknown }).value;
    if (Array.isArray(rawVal) && !("encoder" in node)) {
      const text = rawVal.join("");
      if (text.trim().length > 0) {
        out.push({ kind: "op", text });
      }
      return out;
    }
    out.push({ kind: "val", value: rawVal });
  }

  return out;
}

/**
 * One row in flight, keyed by table name.
 *
 * A table may map to `undefined`: that is a left join which found no match, and
 * every reader below already falls back with `?? {}`, so the row survives with
 * nothing joined onto it rather than disappearing from the result.
 */
type TableRowContext = Record<string, Record<string, unknown> | undefined>;

function resolveValue(token: FlatToken, ctx: TableRowContext, defaultTable: string): unknown {
  if (token.kind === "val") return token.value;
  if (token.kind === "col") {
    const tableRecord = ctx[token.table] ?? ctx[defaultTable] ?? {};
    return tableRecord[token.prop];
  }
  return undefined;
}

/** SQL LIKE pattern to an anchored RegExp: % is any run, _ is one character. */
function likeToRegExp(pattern: string, caseInsensitive: boolean): RegExp {
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, ".*")
    .replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, caseInsensitive ? "i" : "");
}

function compareValues(left: unknown, op: string, right: unknown): boolean {
  const normalizedOp = op.trim().toLowerCase();
  const lNum = left instanceof Date ? left.getTime() : left;
  const rNum = right instanceof Date ? right.getTime() : right;

  switch (normalizedOp) {
    // Text search. Without these the operator fell through to strict equality,
    // so every ilike() filter compared the column to the literal "%term%".
    case "like":
    case "ilike":
    case "not like":
    case "not ilike": {
      if (typeof left !== "string" || typeof right !== "string") return false;
      const matched = likeToRegExp(right, normalizedOp.includes("ilike")).test(left);
      return normalizedOp.startsWith("not") ? !matched : matched;
    }
    case "=":
      return lNum === rNum;
    case "!=":
    case "<>":
      return lNum !== rNum;
    case ">":
      return Number(lNum) > Number(rNum);
    case ">=":
      return Number(lNum) >= Number(rNum);
    case "<":
      return Number(lNum) < Number(rNum);
    case "<=":
      return Number(lNum) <= Number(rNum);
    default:
      return lNum === rNum;
  }
}

/** Text of a drizzle StringChunk ("(", " and ", " = " …), or null for other nodes. */
function stringChunkText(node: unknown): string | null {
  if (!node || typeof node !== "object" || !("value" in node)) return null;
  const value = (node as { value?: unknown }).value;
  if (!Array.isArray(value) || "encoder" in node) return null;
  return value.join("");
}

/**
 * Evaluate a condition against one in-memory row.
 *
 * The flat walk in `matchesConditionInContext` cannot express grouping: it drops
 * parentheses and splits only on `and`, so an `or(...)` filter — used by every
 * admin and dashboard text search — collapsed to its first comparison. Walking
 * the SQL tree first keeps the grouping the query actually asked for, and leaves
 * plain comparisons to the existing (deliberately strict) flat evaluator.
 */
function evaluateCondition(condition: unknown, ctx: TableRowContext, defaultTable: string): boolean {
  if (condition && typeof condition === "object" && "queryChunks" in condition) {
    const chunks = (condition as { queryChunks?: unknown[] }).queryChunks ?? [];
    const parts: unknown[] = [];
    let connector: "and" | "or" | null = null;
    let leaf = false;

    for (const chunk of chunks) {
      const text = stringChunkText(chunk);
      if (text === null) {
        parts.push(chunk);
        continue;
      }
      const trimmed = text.trim();
      if (trimmed === "" || trimmed === "(" || trimmed === ")") continue;
      const logical = /^(and|or)$/i.exec(trimmed);
      // Anything else is a comparison operator: this node is a leaf.
      if (!logical) {
        leaf = true;
        break;
      }
      const found = logical[1].toLowerCase() as "and" | "or";
      // Mixed connectors at one level have no unambiguous flat reading.
      if (connector !== null && connector !== found) {
        leaf = true;
        break;
      }
      connector = found;
    }

    if (!leaf && parts.length === 1) return evaluateCondition(parts[0], ctx, defaultTable);
    if (!leaf && connector && parts.length >= 2) {
      return connector === "and"
        ? parts.every((part) => evaluateCondition(part, ctx, defaultTable))
        : parts.some((part) => evaluateCondition(part, ctx, defaultTable));
    }
  }
  return matchesConditionInContext(ctx, defaultTable, condition);
}

function matchesConditionInContext(
  ctx: TableRowContext,
  defaultTable: string,
  condition: unknown,
): boolean {
  if (!condition) return true;
  const tokens = flattenSqlChunks(condition);
  if (tokens.length === 0) return true;

  // Split by AND keywords while ignoring surrounding parentheses
  const cleaned: FlatToken[] = [];
  const clauses: FlatToken[][] = [];

  for (const tok of tokens) {
    if (tok.kind === "op") {
      const parts = tok.text.split(/\band\b/i);
      parts.forEach((part, index) => {
        const trimmed = part.replace(/[()]/g, "").trim();
        if (index > 0) {
          if (cleaned.length > 0) clauses.push([...cleaned]);
          cleaned.length = 0;
        }
        if (trimmed.length > 0) {
          cleaned.push({ kind: "op", text: trimmed });
        }
      });
    } else {
      cleaned.push(tok);
    }
  }
  if (cleaned.length > 0) clauses.push(cleaned);

  return clauses.every((clause) => {
    const [leftTok, opTok, rightTok] = clause;
    if (!leftTok || !opTok || opTok.kind !== "op") return true;
    const leftVal = resolveValue(leftTok, ctx, defaultTable);
    const operator = opTok.text.trim().toLowerCase();
    // Drizzle emits IS NULL without a right-hand value. Treating a two-token
    // clause as automatically true silently ignored refund safety conditions.
    if (operator === "is null") return leftVal == null;
    if (operator === "is not null") return leftVal != null;
    if (/^(not )?in$/.test(operator)) {
      const candidates = clause
        .slice(2)
        .filter((token) => token.kind === "val")
        .map((token) => (token as { value: unknown }).value);
      if (candidates.length === 0) return true;
      const contained = candidates.some((candidate) => compareValues(leftVal, "=", candidate));
      return operator.startsWith("not") ? !contained : contained;
    }
    if (!rightTok) return true;
    const rightVal = resolveValue(rightTok, ctx, defaultTable);
    return compareValues(leftVal, opTok.text, rightVal);
  });
}

function evaluateSetValue(
  rawValue: unknown,
  row: Record<string, unknown>,
  tableKey: string,
): unknown {
  if (!rawValue || typeof rawValue !== "object" || !("queryChunks" in rawValue)) {
    return rawValue;
  }
  const tokens = flattenSqlChunks(rawValue);
  if (tokens.length >= 3 && tokens[0].kind === "col" && tokens[1].kind === "op") {
    const base = Number(resolveValue(tokens[0], { [tableKey]: row }, tableKey) ?? 0);
    const delta = Number(resolveValue(tokens[2], { [tableKey]: row }, tableKey) ?? 0);
    const op = tokens[1].text.trim();
    if (op === "+") return base + delta;
    if (op === "-") return base - delta;
  }
  return rawValue;
}

function projectRow(
  selection: Record<string, unknown> | undefined,
  ctx: TableRowContext,
  defaultTable: string,
): Record<string, unknown> {
  if (!selection) {
    return { ...(ctx[defaultTable] ?? {}) };
  }
  const result: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(selection)) {
    if (isDrizzleTable(spec)) {
      const tbl = tableNameFor(spec);
      result[key] = { ...(ctx[tbl] ?? {}) };
    } else if (isDrizzleColumn(spec)) {
      const tbl = tableNameFor(spec.table);
      const prop = toCamelCase(spec.name);
      result[key] = (ctx[tbl] ?? ctx[defaultTable] ?? {})[prop];
    } else {
      result[key] = spec;
    }
  }
  return result;
}

function isDrizzleSqlExpression(value: unknown): value is { queryChunks?: unknown[]; decoder?: unknown; name?: string } {
  return !!value && typeof value === "object" && ("queryChunks" in value || "decoder" in value || "shouldInlineParams" in value);
}

function evaluateAggregateExpression(
  spec: { queryChunks?: unknown[]; decoder?: unknown; name?: string },
  contexts: TableRowContext[],
  defaultTable: string,
): unknown {
  const flattened = flattenSqlChunks(spec);
  const columnToken = flattened.find((token) => token.kind === "col");
  const columnName = columnToken?.prop || "";
  const tableName = columnToken?.table || defaultTable;

  // Drizzle's count()/sum()/avg() helpers carry no `.name`; the function only
  // exists in the rendered SQL, so read it from there. Without this every
  // aggregate silently returned null and the preview reported 0 orders/₦0.
  const rendered = flattened
    .map((token) => (token.kind === "op" ? token.text : token.kind === "col" ? " # " : ""))
    .join("")
    .toLowerCase();
  const queryName = (spec.name ?? "").toLowerCase();

  if (queryName.includes("count") || /count\s*\(/.test(rendered)) {
    return contexts.length;
  }

  if (queryName.includes("sum") || queryName.includes("total") || /sum\s*\(/.test(rendered)) {
    return contexts.reduce((sum, ctx) => {
      const row = (ctx[tableName] ?? ctx[defaultTable] ?? {}) as Record<string, unknown>;
      const value = row[columnName];
      return sum + Number(value ?? 0);
    }, 0);
  }

  if (queryName.includes("avg") || /avg\s*\(/.test(rendered)) {
    if (contexts.length === 0) return 0;
    const total = contexts.reduce((sum, ctx) => {
      const row = (ctx[tableName] ?? ctx[defaultTable] ?? {}) as Record<string, unknown>;
      const value = row[columnName];
      return sum + Number(value ?? 0);
    }, 0);
    return total / contexts.length;
  }

  return null;
}

type Pageable<T> = T[] & {
  limit: (count: number) => Pageable<T>;
  offset: (start: number) => Pageable<T>;
};

function withLimit<T>(items: T[]): Pageable<T> {
  return Object.assign([...items], {
    limit(count: number) {
      return withLimit(items.slice(0, count));
    },
    offset(start: number) {
      return withLimit(items.slice(start));
    },
  });
}

function sortDescendingByCreatedAt<T extends Record<string, unknown>>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aTime = a.createdAt instanceof Date ? a.createdAt.getTime() : Number(a.createdAt ?? 0);
    const bTime = b.createdAt instanceof Date ? b.createdAt.getTime() : Number(b.createdAt ?? 0);
    return bTime - aTime;
  });
}

export type PreviewState = Record<
  | "users" | "sessions" | "orders" | "walletTransactions" | "paymentTopups"
  | "contactMessages" | "giftCards" | "scheduledOrders" | "notifications"
  | "securityViolations" | "withdrawals" | "bankAccounts",
  Array<Record<string, unknown>>
>;

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __arenaPryvaMockState?: PreviewState;
};

const mockState: PreviewState =
  globalForDb.__arenaPryvaMockState ?? {
    users: [],
    sessions: [],
    orders: [],
    walletTransactions: [],
    paymentTopups: [],
    contactMessages: [],
    giftCards: [],
    scheduledOrders: [],
    notifications: [],
    securityViolations: [],
    withdrawals: [],
    bankAccounts: [],
  };

// Next can load route handlers and server components in separate bundles.
// Share the in-memory preview state across those bundles in this process.
if (!databaseUrl) {
  for (const key of ["users", "sessions", "orders", "walletTransactions", "paymentTopups", "contactMessages", "giftCards", "scheduledOrders", "notifications", "securityViolations", "withdrawals", "bankAccounts"] as const) {
    mockState[key] ??= [];
  }
  globalForDb.__arenaPryvaMockState = mockState;
}

/**
 * A demo account with nothing in it demonstrates nothing. This seeds the states
 * a real account passes through — a live code on a timer, a rental that is
 * still running, an eSIM, a refunded order and a gift card — plus the wallet
 * ledger that matches them, so the dashboard's live-codes block, refund flow and
 * history all have something to show on first sign-in.
 *
 * The ledger is kept balanced: the credits and debits below end at exactly the
 * demo balance (₦25,000), so "balance" and "sum of transactions" can never
 * disagree in the preview.
 */
function ensureDemoUser() {
  const state = mockState.users;
  const demoUserId = "demo-user";
  const now = Date.now();
  const daysAgo = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000);
  const minutesFromNow = (minutes: number) => new Date(now + minutes * 60 * 1000);

  // Seed per row, not "if the user exists, stop": a preview process that signed
  // in before the orders were added must still pick them up on the next render.
  const seedOnce = (key: keyof PreviewState, row: Record<string, unknown>) => {
    if (!mockState[key].some((existing) => existing.id === row.id)) {
      mockState[key].push(row);
    }
  };

  const hasDemoUser = state.some((user) => user.email === "demo@pryva.ng");
  if (!hasDemoUser) state.push({
    id: demoUserId,
    name: "Ada Demo",
    email: "demo@pryva.ng",
    passwordHash: hashPassword("pryva-demo-2026"),
    walletBalance: 25000,
    createdAt: daysAgo(14),
  });

  const demoOrders: Array<Record<string, unknown>> = [
    {
      id: "demo-order-live",
      reference: "PV-DEMO0001",
      userId: demoUserId,
      service: "numbers",
      productSlug: "vn-ng",
      productName: "Virtual Numbers",
      planLabel: "Nigeria number",
      region: "Nigeria",
      duration: "Single verification · 20 min window",
      amount: 1340,
      status: "active",
      provider: "preview",
      providerRequestId: null,
      referenceCode: "+000 555 4820",
      otpCode: "482069",
      accounts: null,
      expiresAt: minutesFromNow(18),
      refundedAt: null,
      createdAt: new Date(now - 2 * 60 * 1000),
    },
    {
      id: "demo-order-rental",
      reference: "PV-DEMO0002",
      userId: demoUserId,
      service: "numbers",
      productSlug: "rent-ng-7",
      productName: "Virtual Numbers",
      planLabel: "7-day Nigeria rental",
      region: "Nigeria",
      duration: "7 days",
      amount: 4250,
      status: "active",
      provider: "preview",
      providerRequestId: null,
      referenceCode: "+000 555 4820",
      otpCode: null,
      accounts: null,
      expiresAt: new Date(now + 4 * 24 * 60 * 60 * 1000),
      refundedAt: null,
      createdAt: daysAgo(3),
    },
    {
      id: "demo-order-esim",
      reference: "PV-DEMO0003",
      userId: demoUserId,
      service: "esim",
      productSlug: "esim-ng-1",
      productName: "eSIM",
      planLabel: "Nigeria · 1GB · 30 days",
      region: "Nigeria",
      duration: "30 days",
      amount: 4700,
      status: "active",
      provider: "preview",
      providerRequestId: null,
      referenceCode: "LPA:1$demo.invalid$PRYVA-DEMO-1GB-NG",
      otpCode: null,
      accounts: null,
      expiresAt: new Date(now + 24 * 24 * 60 * 60 * 1000),
      refundedAt: null,
      createdAt: daysAgo(6),
    },
    {
      id: "demo-order-refunded",
      reference: "PV-DEMO0004",
      userId: demoUserId,
      service: "numbers",
      productSlug: "vn-us",
      productName: "Virtual Numbers",
      planLabel: "United States number",
      region: "United States",
      duration: "Single verification · 20 min window",
      amount: 1670,
      status: "refunded",
      provider: "preview",
      providerRequestId: null,
      referenceCode: null,
      otpCode: null,
      accounts: null,
      expiresAt: null,
      refundedAt: daysAgo(9),
      createdAt: daysAgo(9),
    },
    {
      id: "demo-order-gift",
      reference: "PV-DEMO0005",
      userId: demoUserId,
      service: "gift-cards",
      productSlug: "gift-5000",
      productName: "Gift Cards",
      planLabel: "₦5,000 gift card",
      region: "Nigeria",
      duration: "90 days to redeem",
      amount: 5000,
      status: "active",
      provider: "preview",
      providerRequestId: null,
      referenceCode: "PRYVA-DEMO-4F2K",
      otpCode: null,
      accounts: null,
      expiresAt: new Date(now + 80 * 24 * 60 * 60 * 1000),
      refundedAt: null,
      createdAt: daysAgo(12),
    },
  ];
  for (const order of demoOrders) seedOnce("orders", order);
  // Safely update older seeded examples in a running preview without resetting
  // the shared wallet or touching real/user-created orders.
  for (const row of mockState.orders) {
    if (row.userId !== demoUserId || row.provider !== "preview") continue;
    if ((row.id === "demo-order-live" || row.id === "demo-order-rental") && row.referenceCode === "+234 812 445 9081") row.referenceCode = "+000 555 4820";
    if (row.id === "demo-order-esim" && row.referenceCode === "LPA:1$rsp.truphone.com$PRYVA-DEMO-1GB-NG") row.referenceCode = "LPA:1$demo.invalid$PRYVA-DEMO-1GB-NG";
  }

  const ledger: Array<[string, string, number, number, string, string, Date]> = [
    // id, description, amount (+/-), balanceAfter, reference, type, createdAt
    ["demo-welcome-credit", "Demo starter wallet credit", 25000, 25000, "TOP-DEMO01", "credit", daysAgo(14)],
    ["demo-tx-gift", "Gift card purchase — ₦5,000", -5000, 20000, "PV-DEMO0005", "debit", daysAgo(12)],
    ["demo-tx-us-number", "US number purchase", -1670, 18330, "PV-DEMO0004", "debit", daysAgo(9)],
    ["demo-tx-refund", "Auto-refund — US number (no code)", 1670, 20000, "RF-DEMO0004", "credit", daysAgo(9)],
    ["demo-tx-esim", "eSIM purchase — Nigeria 1GB", -4700, 15300, "PV-DEMO0003", "debit", daysAgo(6)],
    ["demo-tx-topup", "Wallet top-up — bank transfer", 15290, 30590, "TOP-DEMO02", "credit", daysAgo(4)],
    ["demo-tx-rental", "Nigeria 7-day rental", -4250, 26340, "PV-DEMO0002", "debit", daysAgo(3)],
    ["demo-tx-live", "Nigeria number purchase", -1340, 25000, "PV-DEMO0001", "debit", new Date(now - 2 * 60 * 1000)],
  ];

  for (const [id, description, amount, balanceAfter, reference, type, createdAt] of ledger) {
    seedOnce("walletTransactions", {
      id,
      userId: demoUserId,
      orderId: null,
      type,
      amount: Math.abs(amount),
      balanceAfter,
      description,
      reference,
      createdAt,
    });
  }

  for (const notification of [
    {
      id: "demo-notification-1",
      userId: demoUserId,
      title: "Your Nigeria number is live",
      message: "Demo code 482069 arrived on +000 555 4820. It is fictional.",
      type: "order",
      read: 0,
      createdAt: new Date(now - 2 * 60 * 1000),
    },
    {
      id: "demo-notification-2",
      userId: demoUserId,
      title: "Refund completed",
      message: "₦1,670 returned to your wallet — the US number never delivered a code.",
      type: "refund",
      read: 1,
      createdAt: daysAgo(9),
    },
  ]) {
    seedOnce("notifications", notification);
  }
  const seededNotice = mockState.notifications.find((row) => row.id === "demo-notification-1" && row.userId === demoUserId);
  if (seededNotice?.message === "Code 482069 arrived on +234 812 445 9081. It expires in 20 minutes.") seededNotice.message = "Demo code 482069 arrived on +000 555 4820. It is fictional.";
}

// Gates on the shared predicate, not on DATABASE_URL. Aurora provisioned through
// the Vercel AWS integration has no DATABASE_URL, so testing that variable alone
// seeded the shared demo account -- published credentials and a wallet balance --
// into a process that was connected to a real production database.
if (!persistentDatabaseConfigured()) ensureDemoUser();

/** Read an isolated snapshot; never expose the mutable process-local state. */
export function readPreviewDatabase<T>(reader: (snapshot: PreviewState) => T): T {
  if (persistentDatabaseConfigured()) throw new Error("Preview data unavailable with a persistent database");
  return reader(structuredClone(mockState));
}

/**
 * Commit a synchronous, preview-only mutation as one copy-on-write operation.
 * This is not a PostgreSQL transaction and must never be used for live funds.
 * No event-loop work can interleave while the callback runs; if it throws, the
 * original preview state is untouched. Callbacks must not perform async work.
 */
export function mutatePreviewDatabase<T>(mutation: (draft: PreviewState) => T): T {
  if (persistentDatabaseConfigured()) throw new Error("Preview mutation unavailable with a persistent database");
  const draft = structuredClone(mockState);
  const result = mutation(draft);
  if (result && typeof result === "object" && "then" in result) throw new Error("Preview mutation must be synchronous");
  for (const key of Object.keys(mockState) as Array<keyof PreviewState>) mockState[key] = draft[key];
  return result;
}

/**
 * A select() result that can still be narrowed: where(), and inner or left
 * joins that may themselves be joined or filtered again.
 *
 * A left join with no match keeps the base row and joins nothing onto it, which
 * is what makes an admin queue able to show an order whose customer record is
 * missing instead of dropping the order.
 */
function joinableQuery(
  contexts: TableRowContext[],
  selection: Record<string, unknown> | undefined,
  baseKey: string,
) {
  const join = (joinTable: unknown, onCondition: unknown, keepUnmatched: boolean) => {
    const joinKey = tableNameFor(joinTable) as keyof PreviewState;
    const joinRows = mockState[joinKey] ?? [];
    const joined: TableRowContext[] = contexts.flatMap((ctx) => {
      const matches = joinRows
        .map((candidate) => ({ ...ctx, [joinKey]: candidate }))
        .filter((combined) => evaluateCondition(onCondition, combined, baseKey));
      return matches.length || !keepUnmatched ? matches : [{ ...ctx, [joinKey]: undefined }];
    });
    return joinableQuery(joined, selection, baseKey);
  };

  return Object.assign(buildQueryResult(contexts, selection, baseKey), {
    where(condition: unknown) {
      const filtered = contexts.filter((ctx) => evaluateCondition(condition, ctx, baseKey));
      return buildQueryResult(filtered, selection, baseKey);
    },
    innerJoin(joinTable: unknown, onCondition?: unknown) {
      return join(joinTable, onCondition, false);
    },
    leftJoin(joinTable: unknown, onCondition?: unknown) {
      return join(joinTable, onCondition, true);
    },
  });
}

function buildQueryResult(
  contexts: TableRowContext[],
  selection: Record<string, unknown> | undefined,
  defaultTable: string,
) {
  const hasAggregateSelection =
    !!selection && Object.values(selection).some((spec) => isDrizzleSqlExpression(spec));

  if (hasAggregateSelection) {
    const aggregateRow = {} as Record<string, unknown>;
    for (const [key, spec] of Object.entries(selection ?? {})) {
      if (isDrizzleSqlExpression(spec)) {
        aggregateRow[key] = evaluateAggregateExpression(spec, contexts, defaultTable);
      } else {
        aggregateRow[key] = spec;
      }
    }

    return Object.assign([aggregateRow], {
      orderBy() {
        return withLimit([aggregateRow]);
      },
      limit(count: number) {
        return withLimit([aggregateRow].slice(0, count));
      },
      offset() {
        return withLimit([aggregateRow]);
      },
    });
  }

  const projected = contexts.map((ctx) => projectRow(selection, ctx, defaultTable));
  return Object.assign([...projected], {
    orderBy() {
      const sorted = sortDescendingByCreatedAt(projected);
      return withLimit(sorted);
    },
    limit(count: number) {
      return withLimit(projected.slice(0, count));
    },
    offset(start: number) {
      return withLimit(projected.slice(start));
    },
  });
}

function sortQueryRows<T extends Record<string, unknown>>(rows: T[], orderBy: unknown): T[] {
  const candidates = Array.isArray(orderBy) ? orderBy : [orderBy];
  if (candidates.some((entry) => entry && typeof entry === "object" && "name" in entry)) {
    return sortDescendingByCreatedAt(rows);
  }
  return sortDescendingByCreatedAt(rows);
}

function applyQueryOptions<T extends Record<string, unknown>>(
  rows: T[],
  options: Record<string, unknown> = {},
  tableKey: string,
): T[] {
  let filtered = rows;

  const table = (schema as unknown as Record<string, unknown>)[tableKey];
  const condition = typeof options.where === "function"
    ? options.where(table, getOperators())
    : options.where;
  if (condition) {
    filtered = filtered.filter((row) =>
      evaluateCondition(condition, { [tableKey]: row }, tableKey),
    );
  }

  const ordering = typeof options.orderBy === "function"
    ? options.orderBy(table, getOrderByOperators())
    : options.orderBy;
  if (ordering) {
    filtered = sortQueryRows(filtered, ordering);
  }

  if (typeof options.offset === "number") {
    filtered = filtered.slice(options.offset as number);
  }

  if (typeof options.limit === "number") {
    filtered = filtered.slice(0, options.limit as number);
  }

  return filtered;
}

function projectQueryColumns(row: Record<string, unknown>, columns: unknown): Record<string, unknown> {
  if (!columns || typeof columns !== "object") return { ...row };
  const flags = columns as Record<string, boolean>;
  const include = Object.values(flags).some(Boolean);
  return Object.fromEntries(Object.entries(row).filter(([key]) => include ? flags[key] === true : flags[key] !== false));
}

const mockQuery = Object.fromEntries(
  (Object.keys(mockState) as Array<keyof PreviewState>).map((tableKey) => [
    tableKey,
    {
      async findMany(options: Record<string, unknown> = {}) {
        const rows = applyQueryOptions((mockState[tableKey] ?? []) as Record<string, unknown>[], options, tableKey);
        return rows.map((row) => projectQueryColumns(row, options.columns));
      },
      async findFirst(options: Record<string, unknown> = {}) {
        const rows = applyQueryOptions((mockState[tableKey] ?? []) as Record<string, unknown>[], options, tableKey);
        const row = rows[0];
        return row ? projectQueryColumns(row, options.columns) : undefined;
      },
    },
  ]),
) as Record<string, any>;

const mockDb: any = {
  query: mockQuery,
  async execute() {
    return [{ "?column?": 1 }];
  },
  select(selection?: Record<string, unknown>) {
    return {
      from(table: unknown) {
        const baseKey = tableNameFor(table) as keyof PreviewState;
        const baseRows = mockState[baseKey] ?? [];
        const baseContexts: TableRowContext[] = baseRows.map((row) => ({ [baseKey]: row }));

        return joinableQuery(baseContexts, selection, baseKey);
      },
    };
  },
  insert(table: unknown) {
    const tableKey = tableNameFor(table) as keyof PreviewState;
    return {
      values(value: Record<string, unknown>) {
        const rows = mockState[tableKey] ?? [];
        const row: Record<string, unknown> = {
          status: tableKey === "orders" ? "active" : tableKey === "contactMessages" ? "open" : undefined,
          provider: tableKey === "orders" ? "preview" : undefined,
          walletBalance: tableKey === "users" ? 0 : undefined,
          ...value,
          id: value.id ?? randomBytes(16).toString("hex"),
          createdAt: value.createdAt ?? new Date(),
        };
        rows.push(row);

        const insertedList = [{ ...row }];
        return Object.assign(insertedList, {
          returning(selection?: Record<string, unknown>) {
            return [projectRow(selection, { [tableKey]: row }, tableKey)];
          },
        });
      },
    };
  },
  update(table: unknown) {
    const tableKey = tableNameFor(table) as keyof PreviewState;
    return {
      set(updates: Record<string, unknown>) {
        return {
          where(condition: unknown) {
            const rows = mockState[tableKey] ?? [];
            const matched = rows.filter((row) =>
              evaluateCondition(condition, { [tableKey]: row }, tableKey),
            );
            matched.forEach((row) => {
              for (const [k, v] of Object.entries(updates)) {
                row[k] = evaluateSetValue(v, row, tableKey);
              }
            });

            const updatedCopies = matched.map((row) => ({ ...row }));
            return Object.assign(updatedCopies, {
              returning(selection?: Record<string, unknown>) {
                return matched.map((row) =>
                  projectRow(selection, { [tableKey]: row }, tableKey),
                );
              },
            });
          },
        };
      },
    };
  },
  delete(table: unknown) {
    const tableKey = tableNameFor(table) as keyof PreviewState;
    return {
      where(condition: unknown) {
        const rows = mockState[tableKey] ?? [];
        const survivors = rows.filter(
          (row) => !evaluateCondition(condition, { [tableKey]: row }, tableKey),
        );
        mockState[tableKey] = survivors;
        return { rows: survivors };
      },
    };
  },
  async transaction<T>(callback: (tx: typeof mockDb) => Promise<T> | T): Promise<T> {
    return await callback(mockDb);
  },
};

// Aurora provisioned through the Vercel AWS integration has no DATABASE_URL: it
// authenticates with RDS IAM tokens minted per connection. Treat it as a real
// database, not as "no database configured".
const useAwsIam = !databaseUrl && awsIamConfigured();

export const pool: Pool | null =
  databaseUrl || useAwsIam
    ? (() => {
        const runtimePool =
          globalForDb.__arenaNextJsPostgresqlPool ??
          (databaseUrl
            ? new Pool({ connectionString: databaseUrl })
            : createAwsIamPool());

        if (process.env.NODE_ENV !== "production") {
          globalForDb.__arenaNextJsPostgresqlPool = runtimePool;
        }

        return runtimePool;
      })()
    : null;

// The relational query API needs the schema at runtime. The preview adapter
// implements the subset of this interface used without a database.
export const db: NodePgDatabase<typeof schema> = pool
  ? drizzle(pool, { schema })
  : (mockDb as NodePgDatabase<typeof schema>);
