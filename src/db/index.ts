import { randomBytes, scryptSync } from "node:crypto";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
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

type TableRowContext = Record<string, Record<string, unknown>>;

function resolveValue(token: FlatToken, ctx: TableRowContext, defaultTable: string): unknown {
  if (token.kind === "val") return token.value;
  if (token.kind === "col") {
    const tableRecord = ctx[token.table] ?? ctx[defaultTable] ?? {};
    return tableRecord[token.prop];
  }
  return undefined;
}

function compareValues(left: unknown, op: string, right: unknown): boolean {
  const normalizedOp = op.trim();
  const lNum = left instanceof Date ? left.getTime() : left;
  const rNum = right instanceof Date ? right.getTime() : right;

  switch (normalizedOp) {
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
    if (clause.length < 3) return true;
    const [leftTok, opTok, rightTok] = clause;
    if (!leftTok || !opTok || !rightTok || opTok.kind !== "op") return true;
    const leftVal = resolveValue(leftTok, ctx, defaultTable);
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
  const queryName = (spec.name ?? "").toLowerCase();
  const flattened = flattenSqlChunks(spec);
  const columnToken = flattened.find((token) => token.kind === "col");
  const columnName = columnToken?.prop || "";
  const tableName = columnToken?.table || defaultTable;

  if (queryName.includes("count") || queryName.includes("count")) {
    return contexts.length;
  }

  if (queryName.includes("sum") || queryName.includes("total")) {
    return contexts.reduce((sum, ctx) => {
      const row = (ctx[tableName] ?? ctx[defaultTable] ?? {}) as Record<string, unknown>;
      const value = row[columnName];
      return sum + Number(value ?? 0);
    }, 0);
  }

  if (queryName.includes("avg")) {
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

function withLimit<T>(items: T[]): T[] & { limit: (count: number) => T[] } {
  return Object.assign([...items], {
    limit(count: number) {
      return items.slice(0, count);
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

type MockState = Record<
  | "users" | "sessions" | "orders" | "walletTransactions" | "paymentTopups"
  | "contactMessages" | "giftCards" | "scheduledOrders" | "notifications"
  | "securityViolations" | "withdrawals" | "bankAccounts",
  Array<Record<string, unknown>>
>;

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __arenaPryvaMockState?: MockState;
};

const mockState: MockState =
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

function ensureDemoUser() {
  const state = mockState.users;
  if (!state.some((user) => user.email === "demo@pryva.ng")) {
    const demoUserId = "demo-user";
    state.push({
      id: demoUserId,
      name: "Ada Demo",
      email: "demo@pryva.ng",
      passwordHash: hashPassword("pryva-demo-2026"),
      walletBalance: 25000,
      createdAt: new Date(),
    });
    mockState.walletTransactions.push({
      id: "demo-welcome-credit",
      userId: demoUserId,
      orderId: null,
      type: "credit",
      amount: 25000,
      balanceAfter: 25000,
      description: "Demo starter wallet credit",
      reference: "TOP-DEMO01",
      createdAt: new Date(),
    });
  }
}

if (!databaseUrl) ensureDemoUser();

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
        return [aggregateRow].slice(0, count);
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
      return projected.slice(0, count);
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
      matchesConditionInContext({ [tableKey]: row }, tableKey, condition),
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
  (Object.keys(mockState) as Array<keyof MockState>).map((tableKey) => [
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
        const baseKey = tableNameFor(table) as keyof MockState;
        const baseRows = mockState[baseKey] ?? [];
        const baseContexts: TableRowContext[] = baseRows.map((row) => ({ [baseKey]: row }));

        return Object.assign(buildQueryResult(baseContexts, selection, baseKey), {
          where(condition: unknown) {
            const filtered = baseContexts.filter((ctx) =>
              matchesConditionInContext(ctx, baseKey, condition),
            );
            return buildQueryResult(filtered, selection, baseKey);
          },
          innerJoin(joinTable: unknown, onCondition?: unknown) {
            const joinKey = tableNameFor(joinTable) as keyof MockState;
            const joinRows = mockState[joinKey] ?? [];
            const joinedContexts: TableRowContext[] = baseContexts.flatMap((ctx) =>
              joinRows
                .map((candidate) => ({ ...ctx, [joinKey]: candidate }))
                .filter((combined) => matchesConditionInContext(combined, baseKey, onCondition)),
            );

            return Object.assign(buildQueryResult(joinedContexts, selection, baseKey), {
              where(whereCondition: unknown) {
                const filtered = joinedContexts.filter((ctx) =>
                  matchesConditionInContext(ctx, baseKey, whereCondition),
                );
                return buildQueryResult(filtered, selection, baseKey);
              },
            });
          },
        });
      },
    };
  },
  insert(table: unknown) {
    const tableKey = tableNameFor(table) as keyof MockState;
    return {
      values(value: Record<string, unknown>) {
        const rows = mockState[tableKey] ?? [];
        const row: Record<string, unknown> = {
          status: tableKey === "orders" ? "active" : tableKey === "contactMessages" ? "open" : undefined,
          provider: tableKey === "orders" ? "simulated" : undefined,
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
    const tableKey = tableNameFor(table) as keyof MockState;
    return {
      set(updates: Record<string, unknown>) {
        return {
          where(condition: unknown) {
            const rows = mockState[tableKey] ?? [];
            const matched = rows.filter((row) =>
              matchesConditionInContext({ [tableKey]: row }, tableKey, condition),
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
    const tableKey = tableNameFor(table) as keyof MockState;
    return {
      where(condition: unknown) {
        const rows = mockState[tableKey] ?? [];
        const survivors = rows.filter(
          (row) => !matchesConditionInContext({ [tableKey]: row }, tableKey, condition),
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

export const pool = databaseUrl
  ? (() => {
      const runtimePool =
        globalForDb.__arenaNextJsPostgresqlPool ??
        new Pool({
          connectionString: databaseUrl,
        });

      if (process.env.NODE_ENV !== "production") {
        globalForDb.__arenaNextJsPostgresqlPool = runtimePool;
      }

      return runtimePool;
    })()
  : null;

// The relational query API needs the schema at runtime. The preview adapter
// implements the subset of this interface used without a database.
export const db: NodePgDatabase<typeof schema> = databaseUrl
  ? drizzle(pool as Pool, { schema })
  : (mockDb as NodePgDatabase<typeof schema>);
