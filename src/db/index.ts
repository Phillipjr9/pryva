import { randomBytes, scryptSync } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

function toCamelCase(value: string): string {
  return value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

function tableNameFor(table: unknown): string {
  if (table && typeof table === "object") {
    const drizzleBaseName = Symbol.for("drizzle:BaseName");
    const baseName = (table as Record<PropertyKey, unknown>)[drizzleBaseName];
    if (typeof baseName === "string") return baseName;
    const name = (table as { name?: string }).name;
    if (typeof name === "string") return name;
  }
  return "unknown";
}

function extractColumnName(condition: unknown): string | null {
  if (!condition || typeof condition !== "object" || !("queryChunks" in condition)) {
    return null;
  }

  const { queryChunks } = condition as { queryChunks?: unknown[] };
  const columnChunk = queryChunks?.find(
    (chunk) => !!chunk && typeof chunk === "object" && "name" in chunk && "table" in chunk,
  );

  if (!columnChunk || typeof columnChunk !== "object" || !("name" in columnChunk)) {
    return null;
  }

  const name = String((columnChunk as { name?: string }).name);
  return name ? toCamelCase(name) : null;
}

function extractParamValue(condition: unknown): unknown {
  if (!condition || typeof condition !== "object" || !("queryChunks" in condition)) {
    return undefined;
  }

  const { queryChunks } = condition as { queryChunks?: unknown[] };
  const paramChunk = queryChunks?.find(
    (chunk) =>
      !!chunk &&
      typeof chunk === "object" &&
      "value" in chunk &&
      !("table" in chunk) &&
      !("queryChunks" in chunk),
  );

  if (!paramChunk || typeof paramChunk !== "object" || !("value" in paramChunk)) {
    return undefined;
  }

  return (paramChunk as { value?: unknown }).value;
}

function matchesCondition(record: Record<string, unknown>, condition: unknown): boolean {
  if (!condition || typeof condition !== "object" || !("queryChunks" in condition)) {
    return true;
  }

  const { queryChunks } = condition as { queryChunks?: unknown[] };
  const nested = (queryChunks ?? []).filter(
    (chunk) => !!chunk && typeof chunk === "object" && "queryChunks" in chunk,
  );

  if (nested.length > 0) {
    return nested.every((chunk) => matchesCondition(record, chunk));
  }

  const columnName = extractColumnName(condition);
  const paramValue = extractParamValue(condition);

  if (!columnName || paramValue === undefined) {
    return true;
  }

  const currentValue = record[columnName];
  if (paramValue instanceof Date) {
    return Number(currentValue ?? 0) > Number(paramValue);
  }

  return currentValue === paramValue;
}

function ensureDemoUser() {
  const state = mockState.users;
  if (!state.some((user) => user.email === "demo@pryva.ng")) {
    state.push({
      id: "demo-user",
      name: "Ada Demo",
      email: "demo@pryva.ng",
      passwordHash: hashPassword("pryva-demo-2026"),
      walletBalance: 25000,
      createdAt: new Date(),
    });
  }
}

const mockState = {
  users: [] as Array<Record<string, unknown>>,
  sessions: [] as Array<Record<string, unknown>>,
  orders: [] as Array<Record<string, unknown>>,
  walletTransactions: [] as Array<Record<string, unknown>>,
  contactMessages: [] as Array<Record<string, unknown>>,
};

ensureDemoUser();

const mockDb: any = {
  async execute() {
    return [{ "?column?": 1 }];
  },
  select() {
    return {
      from(table: unknown) {
        const rows = mockState[tableNameFor(table) as keyof typeof mockState] ?? [];

        return {
          where(condition: unknown) {
            const filtered = rows.filter((row) => matchesCondition(row, condition));
            return {
              orderBy() {
                return { limit: (count: number) => filtered.slice(0, count) };
              },
              limit: (count: number) => filtered.slice(0, count),
              innerJoin(joinTable: unknown) {
                return {
                  where(joinCondition: unknown) {
                    const joinRows = filtered.flatMap((row) => {
                      const joinData = mockState[tableNameFor(joinTable) as keyof typeof mockState] ?? [];
                      return joinData
                        .filter((candidate) => matchesCondition(candidate, joinCondition))
                        .map((candidate) => ({ ...row, ...candidate }));
                    });
                    return { limit: (count: number) => joinRows.slice(0, count) };
                  },
                };
              },
            };
          },
          orderBy() {
            return { limit: (count: number) => rows.slice(0, count) };
          },
          limit: (count: number) => rows.slice(0, count),
          innerJoin(joinTable: unknown) {
            return {
              where(joinCondition: unknown) {
                const joinRows = rows.flatMap((row) => {
                  const joinData = mockState[tableNameFor(joinTable) as keyof typeof mockState] ?? [];
                  return joinData
                    .filter((candidate) => matchesCondition(candidate, joinCondition))
                    .map((candidate) => ({ ...row, ...candidate }));
                });
                return { limit: (count: number) => joinRows.slice(0, count) };
              },
            };
          },
        };
      },
    };
  },
  insert(table: unknown) {
    return {
      values(value: Record<string, unknown>) {
        return {
          returning(select?: Record<string, unknown>) {
            const rows = mockState[tableNameFor(table) as keyof typeof mockState] ?? [];
            const row = { ...value, id: value.id ?? randomBytes(16).toString("hex"), createdAt: new Date() };
            rows.push(row);
            return [select ? { ...row, ...select } : row];
          },
        };
      },
    };
  },
  update(table: unknown) {
    return {
      set(updates: Record<string, unknown>) {
        return {
          where(condition: unknown) {
            return {
              returning() {
                const rows = mockState[tableNameFor(table) as keyof typeof mockState] ?? [];
                const matched = rows.filter((row) => matchesCondition(row, condition));
                matched.forEach((row) => {
                  Object.assign(row, updates);
                });
                return matched.map((row) => ({ ...row }));
              },
            };
          },
        };
      },
    };
  },
  delete(table: unknown) {
    return {
      where(condition: unknown) {
        const rows = mockState[tableNameFor(table) as keyof typeof mockState] ?? [];
        const survivors = rows.filter((row) => !matchesCondition(row, condition));
        mockState[tableNameFor(table) as keyof typeof mockState] = survivors;
        return { rows: survivors };
      },
    };
  },
  async transaction<T>(callback: (tx: typeof mockDb) => Promise<T> | T): Promise<T> {
    return await callback(mockDb);
  },
};

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
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

export const db = databaseUrl ? drizzle(pool as Pool) : mockDb;
