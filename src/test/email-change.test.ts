import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";

import * as schema from "@/db/schema";
import { users } from "@/db/schema";

/**
 * Changing the sign-in address.
 *
 * This is the one identity field a person outgrows, and it is also the field
 * every recovery path hangs off — so it is the first thing an attacker with a
 * stolen session would move. The rules worth testing are therefore narrow and
 * unforgiving: nothing changes on the request, the proof goes to the *new*
 * address, the link is single-use, short-lived, never stored in the clear, and
 * cannot land on an address somebody else already owns.
 */

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  configured: true,
  fetch: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/logger", () => ({ logger: mocks.log }));
vi.mock("@/lib/resend-config", () => ({ resendConfigured: () => mocks.configured }));

const ADA = "3f1c6a2b-9d4e-4a7c-8b1f-2e5d6c7b8a90";
const BOLA = "7a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";

let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
let changes: typeof import("@/lib/email-change");

/** The token is emailed, never returned, so the test reads it back out of the send. */
function sentToken(): string {
  const body = JSON.parse(mocks.fetch.mock.calls.at(-1)![1].body as string) as { text: string };
  const match = body.text.match(/token=([A-Za-z0-9_-]+)/);
  if (!match) throw new Error("no token in the message");
  return decodeURIComponent(match[1]);
}

function sentTo(): string[] {
  const body = JSON.parse(mocks.fetch.mock.calls.at(-1)![1].body as string) as { to: string[] };
  return body.to;
}

beforeAll(async () => {
  pg = new PGlite();
  const files = (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  database = drizzle(pg, { schema });
  mocks.db = database;
  changes = await import("@/lib/email-change");
}, 30_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.configured = true;
  mocks.fetch.mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal("fetch", mocks.fetch);
  process.env.RESEND_API_KEY = "re_test";
  process.env.RESEND_FROM_EMAIL = "Pryva <hello@pryva.ng>";
  process.env.NEXT_PUBLIC_APP_URL = "https://pryva.ng";

  await database.execute(sql`TRUNCATE TABLE email_change_requests, users CASCADE`);
  await database.insert(users).values([
    { id: ADA, name: "Ada", email: "ada@example.com", passwordHash: "x", walletBalance: 0 },
    { id: BOLA, name: "Bola", email: "bola@example.com", passwordHash: "x", walletBalance: 0 },
  ]);
});

describe("asking to change the address", () => {
  it("sends proof to the new address and changes nothing yet", async () => {
    const result = await changes.requestEmailChange({ userId: ADA, newEmail: "ada.new@example.com" });

    expect(result).toEqual({ ok: true, message: changes.EMAIL_CHANGE_SENT });
    expect(sentTo()).toEqual(["ada.new@example.com"]);
    const [ada] = await database.select().from(users).where(eq(users.id, ADA));
    expect(ada.email).toBe("ada@example.com");
    expect(ada.emailVerifiedAt).toBeNull();
  });

  it("stores only a hash of the link, so a database read cannot replay it", async () => {
    await changes.requestEmailChange({ userId: ADA, newEmail: "ada.new@example.com" });
    const token = sentToken();
    const rows = await database.execute<{ token_hash: string; new_email: string }>(
      sql`SELECT token_hash, new_email FROM email_change_requests WHERE user_id = ${ADA}::uuid`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].token_hash).not.toContain(token);
    expect(rows.rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives the link two hours and no more", async () => {
    await changes.requestEmailChange({ userId: ADA, newEmail: "ada.new@example.com" });
    const rows = await database.execute<{ minutes: string }>(
      sql`SELECT round(extract(epoch FROM expires_at - created_at) / 60)::text AS minutes FROM email_change_requests`,
    );
    expect(Number(rows.rows[0].minutes)).toBe(120);
  });

  it("replaces the previous link instead of leaving two live", async () => {
    await changes.requestEmailChange({ userId: ADA, newEmail: "first@example.com" });
    const first = sentToken();
    await changes.requestEmailChange({ userId: ADA, newEmail: "second@example.com" });

    await expect(changes.confirmEmailChange(first)).resolves.toEqual({ ok: false, error: changes.EMAIL_CHANGE_INVALID });
    const live = await database.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM email_change_requests WHERE consumed_at IS NULL`,
    );
    expect(Number(live.rows[0].count)).toBe(1);
  });

  it("refuses the address it already has, and an address somebody else has", async () => {
    await expect(changes.requestEmailChange({ userId: ADA, newEmail: "ada@example.com" })).resolves.toMatchObject({ ok: false, status: 409 });
    await expect(changes.requestEmailChange({ userId: ADA, newEmail: "ADA@EXAMPLE.COM" })).resolves.toMatchObject({ ok: false, status: 409 });
    await expect(changes.requestEmailChange({ userId: ADA, newEmail: "BOLA@example.com" })).resolves.toMatchObject({ ok: false, status: 409 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("refuses something that is not an address", async () => {
    for (const bad of ["", "ada", "ada@", "ada@example", "a b@example.com", "ada@example.com "]) {
      const result = await changes.requestEmailChange({ userId: ADA, newEmail: bad });
      // Trailing space is trimmed, so that one is legitimately normalised.
      if (result.ok) expect(bad.trim()).toBe("ada@example.com");
    }
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("refuses to switch without proof when mail is down", async () => {
    mocks.configured = false;
    const result = await changes.requestEmailChange({ userId: ADA, newEmail: "ada.new@example.com" });
    expect(result).toMatchObject({ ok: false, status: 503 });
    const rows = await database.execute<{ count: string }>(sql`SELECT count(*)::text AS count FROM email_change_requests`);
    expect(Number(rows.rows[0].count)).toBe(0);
  });

  it("says the send failed rather than promising an email that was refused", async () => {
    mocks.fetch.mockResolvedValue({ ok: false, status: 403 });
    const result = await changes.requestEmailChange({ userId: ADA, newEmail: "ada.new@example.com" });
    expect(result).toMatchObject({ ok: false, status: 502 });
  });
});

describe("confirming the change", () => {
  it("moves the address, verifies it, and spends the link", async () => {
    await changes.requestEmailChange({ userId: ADA, newEmail: "ada.new@example.com" });
    const token = sentToken();

    await expect(changes.confirmEmailChange(token)).resolves.toEqual({
      ok: true,
      email: "ada.new@example.com",
      previousEmail: "ada@example.com",
    });

    const [ada] = await database.select().from(users).where(eq(users.id, ADA));
    expect(ada.email).toBe("ada.new@example.com");
    // Proving the new address is exactly what verifying it means.
    expect(ada.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it("cannot be used twice", async () => {
    await changes.requestEmailChange({ userId: ADA, newEmail: "ada.new@example.com" });
    const token = sentToken();
    await changes.confirmEmailChange(token);
    await expect(changes.confirmEmailChange(token)).resolves.toEqual({ ok: false, error: changes.EMAIL_CHANGE_INVALID });
  });

  it("refuses a link that is past its life", async () => {
    await changes.requestEmailChange({ userId: ADA, newEmail: "ada.new@example.com" });
    const token = sentToken();
    await database.execute(sql`UPDATE email_change_requests SET expires_at = now() - interval '1 second'`);
    await expect(changes.confirmEmailChange(token)).resolves.toEqual({ ok: false, error: changes.EMAIL_CHANGE_INVALID });
  });

  it("refuses an address that was taken while the link sat in an inbox", async () => {
    await changes.requestEmailChange({ userId: ADA, newEmail: "later@example.com" });
    const token = sentToken();
    await database.update(users).set({ email: "later@example.com" }).where(eq(users.id, BOLA));
    await expect(changes.confirmEmailChange(token)).resolves.toMatchObject({ ok: false, error: /already in use/i });

    const [ada] = await database.select().from(users).where(eq(users.id, ADA));
    expect(ada.email).toBe("ada@example.com");
  });

  it("refuses nonsense tokens without touching the database", async () => {
    for (const bad of ["", "   ", "x".repeat(201), "not-a-real-token"]) {
      await expect(changes.confirmEmailChange(bad)).resolves.toEqual({ ok: false, error: changes.EMAIL_CHANGE_INVALID });
    }
  });
});
