import { readdir, readFile } from "node:fs/promises";
import { readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { users, walletTransactions } from "@/db/schema";

/**
 * Every money total on the wallet ledger page is asked for as
 * `coalesce(sum(...), 0)::int`. `amount` is an `integer` column, so Postgres sums
 * it into a bigint and the cast then demands it fit back into int4: the ceiling is
 * 2,147,483,647 kobo, which is ₦21,474,836.47.
 *
 * The tiles are labelled "in the filter", but the filter is optional -- with no
 * `day` param these are lifetime totals. So the page starts throwing, for the rest
 * of the account's life, the week its lifetime credit volume passes ₦21.5m. And
 * `integer out of range` is an error rather than a truncation, so the operator does
 * not get a wrong number: they get no ledger at all.
 *
 * Real Postgres, because the cast is Postgres's own; the real page, because a
 * server component that throws is exactly what the operator hits.
 */

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/identity/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/identity/auth")>();
  return {
    ...actual,
    requireAdmin: vi.fn().mockResolvedValue({ id: "e6601368-4eef-45e7-a562-f8621c4239f2" }),
  };
});

let pg: PGlite;
let database: PgliteDatabase<typeof schema>;

const USER = "e6601368-4eef-45e7-a562-f8621c4239f2";
/** Fits in int4 on its own. Two of them do not. */
const BIG = 2_000_000_000;

beforeAll(async () => {
  pg = new PGlite();
  const files = (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  database = drizzle(pg, { schema });
  mocks.db = database;
});

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  await database.execute(sql`TRUNCATE TABLE wallet_transactions, users CASCADE`);
  await database.insert(users).values({
    id: USER,
    name: "Ledger Test",
    email: "ledger@example.com",
    passwordHash: "x",
    walletBalance: BIG,
  });
});

function row(type: "credit" | "debit" | "refund", reference: string) {
  return {
    userId: USER,
    type,
    amount: BIG,
    balanceAfter: BIG,
    description: `${type} ${reference}`,
    reference,
    createdAt: new Date("2026-10-30T11:00:00.000Z"),
  };
}

async function renderLedger() {
  const { default: Page } = await import("@/app/admin/(console)/transactions/page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
}

describe("the wallet ledger's lifetime totals", () => {
  it("adds up credits that together are bigger than int4", async () => {
    await database.insert(walletTransactions).values([row("credit", "C-1"), row("credit", "C-2")]);

    const markup = await renderLedger();

    // No single row reaches ₦4bn, so this string can only come from the tile.
    expect(markup).toContain("₦4,000,000,000");
  });

  it("keeps all three tiles on the same footing", async () => {
    await database
      .insert(walletTransactions)
      .values([
        row("credit", "C-1"),
        row("credit", "C-2"),
        row("debit", "D-1"),
        row("debit", "D-2"),
        row("refund", "R-1"),
        row("refund", "R-2"),
      ]);

    const markup = await renderLedger();

    // Credits, debits and refunds each come to ₦4bn; the rows themselves are
    // ₦2,000,000,000, so three occurrences of ₦4bn means all three casts held.
    expect(markup.match(/₦4,000,000,000/g) ?? []).toHaveLength(3);
  });

  it("still prints a total one row can hold", async () => {
    await database.insert(walletTransactions).values([row("credit", "C-1")]);

    const markup = await renderLedger();

    expect(markup).toContain("₦2,000,000,000");
    expect(markup).not.toMatch(/₦(NaN|null|undefined)/);
  });
});

/**
 * Two of the ten money sums are covered by the close's own tests and three by the
 * page above; the gift-card and withdrawal figures have no fixture of their own.
 * This pins the remaining shape where a behavioural test would be all bulkhead and
 * no ship: nothing in `src` may ask Postgres to put a sum of money back into int4.
 */
describe("every money total in the source", () => {
  it("never casts a sum of kobo to int4", () => {
    const files = readdirSync("src", { recursive: true })
      .map(String)
      // The test that asks for this pattern in order to forbid it quotes it.
      .filter((name) => /\.tsx?$/.test(name) && !name.startsWith("test/"));
    const offending: string[] = [];

    for (const name of files) {
      const text = readFileSync(`src/${name}`, "utf8");
      text.split("\n").forEach((line, index) => {
        if (/sum\(.*\)::int\b/.test(line)) offending.push(`${name}:${index + 1}`);
      });
    }

    expect(offending).toEqual([]);
  });
});
