import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";

import * as schema from "@/db/schema";
import { users } from "@/db/schema";
import { makeNumberCodeEmail } from "@/lib/number-email-template";

/**
 * "Your code arrived."
 *
 * The email itself is one thing; the harder question is *when* it is sent. The
 * trigger below is what decides, and the two ways it can go wrong are opposite:
 * too eager (one email per message on a rental, or a preview number nobody can
 * receive on) and too quiet (a single verification code that only lived on a
 * page the customer had already closed).
 */

const USER = "3f1c6a2b-9d4e-4a7c-8b1f-2e5d6c7b8a90";

const base = {
  recipient: "ada@example.com",
  sender: "Pryva <hello@pryva.ng>",
  orderReference: "PRI-8F2K1",
  productName: "Vietnam number",
  planLabel: "1 verification",
  region: "Vietnam",
  phoneNumber: "+84912345678",
  code: "481920",
  expiresAt: new Date("2026-03-04T10:20:00Z"),
  orderUrl: "https://pryva.ng/dashboard/orders/abc",
};

let pg: PGlite;
let database: PgliteDatabase<typeof schema>;

beforeAll(async () => {
  pg = new PGlite();
  const files = (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  database = drizzle(pg, { schema });
}, 30_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  await database.execute(sql`TRUNCATE TABLE wallet_email_outbox, orders, users CASCADE`);
  await database.insert(users).values({ id: USER, name: "Ada", email: "ada@example.com", passwordHash: "x", walletBalance: 0 });
});

async function insertOrder(overrides: Record<string, unknown> = {}) {
  const { rows } = await database.execute<{ id: string }>(sql`
    INSERT INTO orders (reference, user_id, service, product_slug, product_name, plan_label, region, duration, amount, provider, otp_code, reference_code)
    VALUES (${`PRI-${Math.random().toString(36).slice(2, 8).toUpperCase()}`}, ${USER}, 'numbers', 'vn-otp', 'Vietnam number', '1 verification',
            'Vietnam', ${(overrides.duration as string) ?? "One-time"}, 1340, ${(overrides.provider as string) ?? "bitcall"},
            ${(overrides.otpCode as string | null) ?? null}, ${(overrides.phone as string | null) ?? "+84912345678"})
    RETURNING id
  `);
  return rows[0].id;
}

async function codeEmails() {
  const { rows } = await database.execute<{ count: string }>(
    sql`SELECT count(*)::text AS count FROM wallet_email_outbox WHERE event_kind = 'number_code'`,
  );
  return Number(rows[0].count);
}

describe("the verification code email", () => {
  it("puts the code where it can be read from a phone notification", () => {
    const message = makeNumberCodeEmail(base);
    expect(message.subject).toContain("481920");
    expect(message.text).toContain("481920");
    expect(message.html).toContain("481920");
    expect(message.to).toEqual(["ada@example.com"]);
  });

  it("names the number, the plan and when it stops receiving", () => {
    const message = makeNumberCodeEmail(base);
    expect(message.text).toContain("+84912345678");
    expect(message.text).toContain("Vietnam number");
    expect(message.text).toContain("PRI-8F2K1");
    expect(message.text).toContain("10:20 UTC");
  });

  it("says nobody will ask for the code, so a caller cannot talk it out of the customer", () => {
    expect(makeNumberCodeEmail(base).text).toMatch(/nobody at pryva will ask you for it/i);
    expect(makeNumberCodeEmail(base).html).toMatch(/nobody at pryva will ask you for it/i);
  });

  it("survives a code that looks like markup", () => {
    const message = makeNumberCodeEmail({ ...base, code: "<b>12</b>" });
    expect(message.html).toContain("&lt;b&gt;12&lt;/b&gt;");
    expect(message.html).not.toContain("<b>12</b>");
  });

  it("refuses invalid notification data instead of sending a half-empty message", () => {
    expect(() => makeNumberCodeEmail({ ...base, recipient: "not-an-email" })).toThrow();
    expect(() => makeNumberCodeEmail({ ...base, code: "   " })).toThrow();
    expect(() => makeNumberCodeEmail({ ...base, sender: "x\r\nBcc: evil@example.com" })).toThrow();
  });
});

describe("when the trigger decides to send it", () => {
  it("queues one code email when the code lands", async () => {
    await insertOrder({ otpCode: "481920" });
    expect(await codeEmails()).toBe(1);
  });

  it("does not queue anything for an order that has not received a code yet", async () => {
    await insertOrder({ otpCode: null });
    expect(await codeEmails()).toBe(0);
  });

  it("does not re-send when the row is updated without a new code", async () => {
    const id = await insertOrder({ otpCode: "481920" });
    await database.execute(sql`UPDATE orders SET status = 'active' WHERE id = ${id}`);
    expect(await codeEmails()).toBe(1);
  });

  it("sends again when a different code arrives, because that is news", async () => {
    const id = await insertOrder({ otpCode: "111111" });
    await database.execute(sql`UPDATE orders SET otp_code = '222222' WHERE id = ${id}`);
    expect(await codeEmails()).toBe(2);
  });

  it("stays quiet on rentals, where one email per message would be spam", async () => {
    const id = await insertOrder({ otpCode: null, duration: "Rent 30 days" });
    await database.execute(sql`UPDATE orders SET otp_code = '333333' WHERE id = ${id}`);
    expect(await codeEmails()).toBe(0);
  });

  it("stays quiet on preview rows, whose codes are not real", async () => {
    const id = await insertOrder({ otpCode: null, provider: "preview" });
    await database.execute(sql`UPDATE orders SET otp_code = '444444' WHERE id = ${id}`);
    expect(await codeEmails()).toBe(0);
  });

  it("targets the account's own address, not anything on the order", async () => {
    await insertOrder({ otpCode: "555555" });
    const { rows } = await database.execute<{ recipient: string }>(
      sql`SELECT recipient FROM wallet_email_outbox WHERE event_kind = 'number_code'`,
    );
    expect(rows.map((row) => row.recipient)).toEqual(["ada@example.com"]);
  });
});
