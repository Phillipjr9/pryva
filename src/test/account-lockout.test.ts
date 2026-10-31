import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq, inArray } from "drizzle-orm";
import * as schema from "@/db/schema";
import { users } from "@/db/schema";

/**
 * Real SQL in embedded PostgreSQL, like the other integration tests: the
 * interesting part of the lockout is a single atomic UPDATE, and a mock would
 * not tell us whether the CASE expressions agree with each other.
 */
const mocks = vi.hoisted(() => ({ db: undefined as unknown }));

vi.mock("@/db", () => ({ get db() { return mocks.db; } }));

let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
let lockout: typeof import("@/lib/account-lockout");

const USER = "2f8f1cad-1a2f-4d0c-9d6e-2b1f7f4d5c11";

beforeAll(async () => {
  pg = new PGlite();
  // Every migration, in order — the same thing `npm run db:migrate` does. This
  // proves 0017 applies on top of a real schema rather than only on a hand-made
  // table, and it is what makes the insert below fail if a column is missing.
  const files = (await readdir("migrations"))
    .filter((name) => /^\d{4}_.*\.sql$/.test(name))
    .sort();
  // The list is applied in filename order; 0017 has to be in it, and nothing may
  // sort after it silently (a mis-numbered migration would run out of order).
  expect(files).toContain("0017_login_lockout.sql");
  expect([...files].sort()).toEqual(files);
  for (const file of files) {
    await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  }
  database = drizzle(pg, { schema });
  mocks.db = database;
  lockout = await import("@/lib/account-lockout");
});

const seeded: string[] = [];

afterEach(async () => {
  // Each test starts from a clean row rather than reusing one: the lock is
  // stateful, and a leftover `locked_until` would make the next test pass for
  // the wrong reason.
  if (seeded.length > 0) {
    await database.delete(users).where(inArray(users.id, seeded.splice(0)));
  }
});

afterAll(async () => {
  await pg?.close();
});

async function seedUser(id = USER) {
  seeded.push(id);
  await database.insert(users).values({
    id,
    name: "Lockout Test",
    email: `${id}@example.com`,
    passwordHash: "x",
    walletBalance: 0,
  });
}

async function rowOf(id = USER) {
  const [row] = await database.select().from(users).where(eq(users.id, id)).limit(1);
  return row;
}

describe("account lockout", () => {
  it("states the policy in one place", () => {
    expect(lockout.LOCKOUT_THRESHOLD).toBe(8);
    expect(lockout.LOCKOUT_DURATION_MS).toBe(30 * 60 * 1000);
  });

  it("counts consecutive failures without locking early", async () => {
    await seedUser();
    for (let attempt = 1; attempt < lockout.LOCKOUT_THRESHOLD; attempt += 1) {
      const state = await lockout.recordFailedLogin(USER);
      expect(state.attempts, `attempt ${attempt}`).toBe(attempt);
      expect(state.lockedUntil, `attempt ${attempt} must not lock`).toBeNull();
    }
    const row = await rowOf();
    expect(row.failedLoginAttempts).toBe(lockout.LOCKOUT_THRESHOLD - 1);
    expect(row.lockedUntil).toBeNull();
    expect(lockout.isAccountLocked(row)).toBe(false);
  });

  it("locks on the threshold attempt, for the stated duration, and resets the count", async () => {
    await seedUser();
    let state: { attempts: number; lockedUntil: Date | null } | null = null;
    for (let attempt = 1; attempt <= lockout.LOCKOUT_THRESHOLD; attempt += 1) {
      state = await lockout.recordFailedLogin(USER);
    }
    expect(state?.lockedUntil).toBeInstanceOf(Date);
    // The lock is set to now + duration, give or take the statement's own clock.
    const remaining = state!.lockedUntil!.getTime() - Date.now();
    expect(remaining).toBeGreaterThan(lockout.LOCKOUT_DURATION_MS - 5_000);
    expect(remaining).toBeLessThanOrEqual(lockout.LOCKOUT_DURATION_MS);
    // The counter resets with the lock, so the run after it expires is fresh.
    expect(state?.attempts).toBe(0);

    const row = await rowOf();
    expect(lockout.isAccountLocked(row)).toBe(true);
    expect(lockout.lockoutRemainingMs(row)).toBeGreaterThan(0);
    expect(lockout.lockoutRemainingMs(row)).toBeLessThanOrEqual(lockout.LOCKOUT_DURATION_MS);
  });

  it("stops being locked once the instant passes, with no job involved", async () => {
    await seedUser();
    for (let attempt = 0; attempt < lockout.LOCKOUT_THRESHOLD; attempt += 1) {
      await lockout.recordFailedLogin(USER);
    }
    const row = await rowOf();
    const lockedUntil = new Date(row.lockedUntil!).getTime();
    expect(lockout.isAccountLocked(row, lockedUntil - 1)).toBe(true);
    expect(lockout.isAccountLocked(row, lockedUntil)).toBe(false);
    expect(lockout.isAccountLocked(row, lockedUntil + 60_000)).toBe(false);
    expect(lockout.lockoutRemainingMs(row, lockedUntil + 1)).toBe(0);
  });

  it("clears the run on a successful sign-in", async () => {
    await seedUser();
    await lockout.recordFailedLogin(USER);
    await lockout.recordFailedLogin(USER);
    await lockout.clearFailedLogins(USER);
    const row = await rowOf();
    expect(row.failedLoginAttempts).toBe(0);
    expect(row.lockedUntil).toBeNull();
  });

  it("also releases a lock that is already set", async () => {
    await seedUser();
    for (let attempt = 0; attempt < lockout.LOCKOUT_THRESHOLD; attempt += 1) {
      await lockout.recordFailedLogin(USER);
    }
    expect(lockout.isAccountLocked(await rowOf())).toBe(true);
    await lockout.clearFailedLogins(USER);
    expect(lockout.isAccountLocked(await rowOf())).toBe(false);
  });

  it("does not confuse a new account with a locked one", async () => {
    const OTHER = "9b1c0d2e-3f4a-4b5c-8d6e-7f8091a2b3c4";
    await seedUser(OTHER);
    const row = await rowOf(OTHER);
    expect(row.failedLoginAttempts).toBe(0);
    expect(row.lockedUntil).toBeNull();
    expect(lockout.isAccountLocked(row)).toBe(false);
  });

  it("survives junk timestamps instead of locking a user out forever", () => {
    expect(lockout.lockoutRemainingMs({ id: "x", lockedUntil: null })).toBe(0);
    expect(lockout.lockoutRemainingMs({ id: "x", lockedUntil: "not a date" })).toBe(0);
    expect(lockout.isAccountLocked({ id: "x", lockedUntil: undefined })).toBe(false);
  });
});

describe("the sign-in path uses it", () => {
  const login = readFileSync("src/app/api/auth/login/route.ts", "utf8");

  it("refuses a locked account before comparing the password", () => {
    const lockCheck = login.indexOf("lockoutRemainingMs(user)");
    const passwordCheck = login.indexOf("verifyPassword(password, user.passwordHash)");
    expect(lockCheck).toBeGreaterThan(-1);
    expect(passwordCheck).toBeGreaterThan(lockCheck);
  });

  it("counts a wrong password and clears the run on success", () => {
    expect(login).toContain("recordFailedLogin(user.id)");
    expect(login).toContain("clearFailedLogins(user.id)");
  });

  it("answers with a 429 and a Retry-After, not a new status an attacker can read", () => {
    expect(login).toContain("status: 429");
    expect(login).toContain('"Retry-After"');
    // The literal 423 (Locked) is a WebDAV status browsers and CDNs treat
    // inconsistently; the shape has to match the limiter's 429 exactly.
    expect(login).not.toContain("423");
  });

  it("releases the lock when a password reset completes", () => {
    const reset = readFileSync("src/lib/password-reset.ts", "utf8");
    expect(reset).toContain("failedLoginAttempts: 0");
    expect(reset).toContain("lockedUntil: null");
  });
});
