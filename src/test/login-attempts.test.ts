import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";

import * as schema from "@/db/schema";
import { fraudEvents, users } from "@/db/schema";

/**
 * "What happens when someone tries 10,000 passwords on one account in a minute?"
 *
 * The limits already refused them. What was missing is that nobody could see it
 * happen: a wrong password, a throttled request and a locked account each wrote
 * nothing, and nothing told an operator. These tests hold sign-in to the other
 * half — every failed attempt leaves a line, an attack rings once, and none of
 * it can change or delay the answer the visitor gets.
 *
 * Real routes, real SQL in embedded PostgreSQL, and the shared rate-limit store
 * rather than the per-process preview one: "once per window across every
 * instance" is a property of the SQL, so that is what has to be exercised.
 */

type Deferred = () => Promise<void> | void;

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  /** What `after()` does. Swapped per test: capture, or throw as it does with no request scope. */
  after: (task: Deferred): void => {
    void task;
  },
  session: vi.fn(async () => "session-token"),
}));

vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: Deferred) => mocks.after(task),
}));
vi.mock("@/lib/identity/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/identity/auth")>()),
  // Issuing a session writes a cookie, which needs a real request scope.
  createSession: mocks.session,
}));

const PASSWORD = "correct horse battery staple";
const ADA = "a1a1a1a1-1111-4111-8111-111111111111";
const GRACE = "b2b2b2b2-2222-4222-8222-222222222222";
const SUSPENDED = "c3c3c3c3-3333-4333-8333-333333333333";
const IP = "203.0.113.10";
const SITE_TALLY = createHash("sha256").update("signin:failures").digest("hex");

let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
let passwordHash: string;
let login: typeof import("@/app/api/auth/login/route");
let secondStep: typeof import("@/app/api/auth/2fa/route");
let attempts: typeof import("@/lib/identity/login-attempts");
let fraud: typeof import("@/lib/admin/fraud");
let twoFactor: typeof import("@/lib/identity/two-factor");
let totp: typeof import("@/lib/identity/totp");
let alerts: typeof import("@/lib/platform/alerts");
let limits: typeof import("@/lib/platform/rate-limit");

let pending: Deferred[] = [];
let warn: MockInstance<typeof console.warn>;
let fetchMock: MockInstance<typeof fetch>;

beforeAll(async () => {
  pg = new PGlite();
  const files = (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  database = drizzle(pg, { schema });
  mocks.db = database;

  const auth = await import("@/lib/identity/auth");
  passwordHash = auth.hashPassword(PASSWORD);
  login = await import("@/app/api/auth/login/route");
  secondStep = await import("@/app/api/auth/2fa/route");
  attempts = await import("@/lib/identity/login-attempts");
  fraud = await import("@/lib/admin/fraud");
  twoFactor = await import("@/lib/identity/two-factor");
  totp = await import("@/lib/identity/totp");
  alerts = await import("@/lib/platform/alerts");
  limits = await import("@/lib/platform/rate-limit");
}, 60_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  mocks.db = database;
  // A configured database: the limiter and the tallies use the shared SQL store.
  vi.stubEnv("DATABASE_URL", "postgres://embedded-test/db");
  vi.stubEnv("TWO_FACTOR_KEY", "a-test-passphrase-that-is-long-enough");
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("RESEND_FROM_EMAIL", "");
  vi.stubEnv("FRAUD_ALERT_EMAIL", "");
  vi.stubEnv("ADMIN_EMAILS", "");
  vi.stubEnv("ALERT_WEBHOOK_URL", "");
  alerts.resetAlertThrottle();
  attempts.resetSignInTallies();

  await database.execute(sql`TRUNCATE TABLE rate_limit_buckets, fraud_events, users CASCADE`);
  await database.insert(users).values([
    { id: ADA, name: "Ada", email: "ada@example.test", passwordHash, walletBalance: 0 },
    { id: GRACE, name: "Grace", email: "grace@example.test", passwordHash, walletBalance: 0 },
    {
      id: SUSPENDED,
      name: "Closed",
      email: "closed@example.test",
      passwordHash,
      walletBalance: 0,
      suspendedAt: new Date(),
    },
  ]);

  pending = [];
  mocks.after = (task) => {
    pending.push(task);
  };
  mocks.session.mockClear();
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function signIn(email: string, password: string, ip = IP) {
  return login.POST(
    new Request("https://pryva.test/api/auth/login", {
      method: "POST",
      headers: {
        host: "pryva.test",
        "x-forwarded-proto": "https",
        origin: "https://pryva.test",
        "content-type": "application/json",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify({ email, password }),
    }),
  );
}

function submitCode(challengeToken: string, code: string, ip = IP) {
  return secondStep.POST(
    new NextRequest("https://pryva.test/api/auth/2fa", {
      method: "POST",
      headers: {
        host: "pryva.test",
        "x-forwarded-proto": "https",
        origin: "https://pryva.test",
        "content-type": "application/json",
        "x-forwarded-for": ip,
      },
      body: JSON.stringify({ challengeToken, code }),
    }),
  );
}

/** Run what the routes deferred with `after()`. */
async function flush() {
  for (const task of pending.splice(0)) await task();
}

/** The `Sign-in failed` lines written so far: the raw text and the parsed context. */
function failures() {
  return warn.mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.includes("Sign-in failed"))
    .map((line) => ({ line, context: JSON.parse(line.slice(line.indexOf("{"))) as Record<string, unknown> }));
}

function queued(kind: string) {
  return database.select().from(fraudEvents).where(eq(fraudEvents.kind, kind));
}

async function siteTally(): Promise<number> {
  const result = await pg.query<{ count: number }>("SELECT count FROM rate_limit_buckets WHERE key = $1", [SITE_TALLY]);
  return result.rows[0]?.count ?? 0;
}

/** The next fifteen-minute window: the limiter's buckets empty, the tallies kept. */
async function nextLimiterWindow() {
  await pg.query("DELETE FROM rate_limit_buckets WHERE key <> $1", [SITE_TALLY]);
}

function mailAndWebhookConfigured() {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("RESEND_FROM_EMAIL", "Pryva <no-reply@example.test>");
  vi.stubEnv("FRAUD_ALERT_EMAIL", "security@example.test");
  vi.stubEnv("ALERT_WEBHOOK_URL", "https://hooks.example.test/alerts");
}

function sent(url: string) {
  return fetchMock.mock.calls.filter((call) => String(call[0]).startsWith(url));
}

describe("every failed sign-in leaves a line", () => {
  it("a wrong password: why, which account and which network — never the secret", async () => {
    const response = await signIn("ada@example.test", "hunter2-wrong-guess");

    expect(response.status).toBe(401);
    const [entry, ...rest] = failures();
    expect(rest).toHaveLength(0);
    expect(entry.context).toEqual({
      reason: "wrong_password",
      userId: ADA,
      // The same hash the fraud tables store, so a line can be matched to a row.
      network: fraud.hashSignal(IP),
    });
    expect(entry.line).not.toContain("hunter2-wrong-guess");
    expect(entry.line).not.toContain("ada@example.test");
    expect(entry.line).not.toContain(IP);
  });

  it("an address nobody has: a hash of it, so a repeated target can be seen without storing it", async () => {
    const response = await signIn("nobody@example.test", "whatever-1");

    expect(response.status).toBe(401);
    const [entry] = failures();
    expect(entry.context).toEqual({
      reason: "unknown_account",
      address: fraud.hashSignal("nobody@example.test"),
      network: fraud.hashSignal(IP),
    });
    expect(entry.line).not.toContain("nobody@example.test");
    expect(entry.line).not.toContain("whatever-1");
  });

  it("does not change the reply: a wrong password and an unknown address still look the same", async () => {
    const wrong = await signIn("ada@example.test", "not-the-password");
    const unknown = await signIn("nobody@example.test", "not-the-password");

    expect(wrong.status).toBe(unknown.status);
    expect(await wrong.json()).toEqual(await unknown.json());
    expect([...wrong.headers.keys()].sort()).toEqual([...unknown.headers.keys()].sort());
  });

  it("a throttled request, which is most of a real attack", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) await signIn("ada@example.test", `guess-${attempt}`);
    const sixth = await signIn("ada@example.test", "guess-5");

    expect(sixth.status).toBe(429);
    const reasons = failures().map((entry) => entry.context.reason);
    expect(reasons).toEqual([...Array<string>(5).fill("wrong_password"), "throttled"]);
    // The limiter turned it away before the account was looked up.
    expect(failures()[5].context).toEqual({
      reason: "throttled",
      address: fraud.hashSignal("ada@example.test"),
      network: fraud.hashSignal(IP),
    });
  });

  it("a closed account", async () => {
    const response = await signIn("closed@example.test", PASSWORD);

    expect(response.status).toBe(401);
    expect(failures()[0].context).toMatchObject({ reason: "closed_account", userId: SUSPENDED });
  });

  it("writes nothing for a sign-in that worked", async () => {
    const response = await signIn("ada@example.test", PASSWORD);
    await flush();

    expect(response.status).toBe(200);
    expect(mocks.session).toHaveBeenCalledTimes(1);
    expect(failures()).toHaveLength(0);
    expect(await siteTally()).toBe(0);
  });

  it("writes nothing for a request that was never a guess", async () => {
    // No Origin, not JSON, no password: refused before anything is checked.
    const noOrigin = await login.POST(
      new Request("https://pryva.test/api/auth/login", {
        method: "POST",
        headers: { host: "pryva.test", "x-forwarded-proto": "https", "content-type": "application/json" },
        body: JSON.stringify({ email: "ada@example.test", password: "x" }),
      }),
    );
    const empty = await signIn("ada@example.test", "");

    expect(noOrigin.status).toBe(403);
    expect(empty.status).toBe(400);
    expect(failures()).toHaveLength(0);
  });

  it("does not call the limiter's own outage a guess", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.db = { execute: async () => { throw new Error("connection refused"); } };

    const response = await signIn("ada@example.test", "guess");

    // Fails closed, as before — and is not counted as somebody guessing.
    expect(response.status).toBe(503);
    expect(failures()).toHaveLength(0);
  });
});

describe("counting never delays or changes the answer", () => {
  it("is deferred until after the response", async () => {
    const response = await signIn("ada@example.test", "wrong");

    // The reply is already decided and the line is already written...
    expect(response.status).toBe(401);
    expect(failures()).toHaveLength(1);
    // ...and the counter has not been touched yet.
    expect(pending).toHaveLength(1);
    expect(await siteTally()).toBe(0);

    await flush();
    expect(await siteTally()).toBe(1);
  });

  it("still counts when there is no request scope to defer into", async () => {
    mocks.after = () => {
      throw new Error("`after` was called outside a request scope");
    };

    const response = await signIn("ada@example.test", "wrong");

    expect(response.status).toBe(401);
    await vi.waitFor(async () => expect(await siteTally()).toBe(1));
  });

  it("answers the same when the database cannot take the count", async () => {
    const response = await signIn("ada@example.test", "wrong");
    expect(response.status).toBe(401);

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.db = new Proxy({}, { get: () => () => { throw new Error("database is down"); } });
    await expect(flush()).resolves.toBeUndefined();
    await expect(
      attempts.countFailedSignIn({ reason: "wrong_password", userId: ADA, lockedNow: true }, null),
    ).resolves.toBeUndefined();
    await expect(
      attempts.countFailedSignIn({ reason: "wrong_second_factor", userId: ADA }, null),
    ).resolves.toBeUndefined();
  });

  it("never throws into the route, whatever it is handed", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = { headers: { get: () => { throw new Error("no headers"); } } } as unknown as Request;

    expect(() => attempts.noteFailedSignIn(broken, { reason: "wrong_password", userId: ADA })).not.toThrow();
    expect(pending).toHaveLength(0);
  });
});

describe("an account locked by wrong passwords", () => {
  async function lockAda() {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      // Five attempts per address per window: the eighth lands in the next one.
      if (attempt === 5) await nextLimiterWindow();
      statuses.push((await signIn("ada@example.test", `guess-${attempt}`)).status);
    }
    return statuses;
  }

  it("is queued for an operator by the attempt that locked it", async () => {
    const statuses = await lockAda();
    await flush();

    expect(statuses).toEqual([401, 401, 401, 401, 401, 401, 401, 429]);
    expect(failures().at(-1)?.context).toMatchObject({ reason: "wrong_password", userId: ADA, locked: true });
    expect(failures().filter((entry) => entry.context.locked)).toHaveLength(1);

    const rows = await queued("login_lockout");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: ADA, severity: "warn", ipHash: fraud.hashSignal(IP), reviewedAt: null });
    expect(rows[0].reasons).toContain("8 wrong passwords in a row");
    expect(rows[0].reasons).toContain("30 minutes");
  });

  it("is not mailed: anybody who knows an address can lock it", async () => {
    mailAndWebhookConfigured();

    await lockAda();
    await flush();

    expect(await queued("login_lockout")).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("logs the attempts the lock refuses, without queueing the lock again", async () => {
    await lockAda();
    await nextLimiterWindow();

    // Even the right password is refused while the lock holds.
    const refused = await signIn("ada@example.test", PASSWORD);
    await flush();

    expect(refused.status).toBe(429);
    expect(failures().at(-1)?.context).toEqual({
      reason: "account_locked",
      userId: ADA,
      network: fraud.hashSignal(IP),
    });
    expect(await queued("login_lockout")).toHaveLength(1);
  });
});

describe("an attack across the whole site", () => {
  const fail = (count: number) =>
    Promise.all(Array.from({ length: count }, () => attempts.countFailedSignIn({ reason: "throttled" }, null)));

  it("says nothing below the threshold", async () => {
    mailAndWebhookConfigured();

    await fail(limits.FAILED_SIGN_IN_ALERT_THRESHOLD - 1);

    expect(await siteTally()).toBe(99);
    expect(await queued("login_failure_spike")).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rings once when an hour's failures reach it: the queue, the inbox and the webhook", async () => {
    mailAndWebhookConfigured();

    await fail(limits.FAILED_SIGN_IN_ALERT_THRESHOLD);

    const rows = await queued("login_failure_spike");
    expect(rows).toHaveLength(1);
    // No account: the signal is the count, not any one of them.
    expect(rows[0]).toMatchObject({ severity: "high", userId: null });
    expect(rows[0].reasons).toContain("100 failed sign-in attempts within an hour");

    const mail = sent("https://api.resend.com/emails");
    expect(mail).toHaveLength(1);
    const message = JSON.parse(String((mail[0][1] as RequestInit).body)) as { to: string[]; subject: string; text: string };
    expect(message.to).toEqual(["security@example.test"]);
    expect(message.subject).toContain("Sign-in attack");
    expect(message.text).toContain("Search the logs for");

    const hook = sent("https://hooks.example.test/alerts");
    expect(hook).toHaveLength(1);
    const posted = JSON.parse(String((hook[0][1] as RequestInit).body)) as { text: string };
    expect(posted.text).toContain("Sign-in attack");
    expect(posted.text).toContain('"threshold":100');
    // A count and a window. No address, no network.
    expect(posted.text).not.toMatch(/[0-9a-f]{64}/);
    expect(posted.text).not.toContain("@");
  });

  it("does not ring again for the rest of the hour, however long the attack runs", async () => {
    mailAndWebhookConfigured();

    await fail(limits.FAILED_SIGN_IN_ALERT_THRESHOLD);
    await fail(400);

    expect(await queued("login_failure_spike")).toHaveLength(1);
    expect(sent("https://api.resend.com/emails")).toHaveLength(1);
    expect(sent("https://hooks.example.test/alerts")).toHaveLength(1);
  });

  it("stops writing once the hour's alert is out: a flood must not become database load", async () => {
    await fail(limits.FAILED_SIGN_IN_ALERT_THRESHOLD);
    const execute = vi.spyOn(database, "execute");

    // The rest of the attack: thousands of these, each after its own response.
    for (let attempt = 0; attempt < 200; attempt += 1) {
      await attempts.countFailedSignIn({ reason: "throttled" }, null);
    }

    // Not one statement. The busiest row in an attack is left alone.
    expect(execute).not.toHaveBeenCalled();
    expect(await siteTally()).toBe(limits.FAILED_SIGN_IN_ALERT_THRESHOLD);
  });

  it("a server that has not seen the alert learns it from the store with one write", async () => {
    await fail(limits.FAILED_SIGN_IN_ALERT_THRESHOLD);
    // Another instance: same database, none of this one's memory.
    attempts.resetSignInTallies();
    const execute = vi.spyOn(database, "execute");

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await attempts.countFailedSignIn({ reason: "throttled" }, null);
    }

    expect(execute).toHaveBeenCalledTimes(1);
    // And it did not ring a second time for the same hour.
    expect(await queued("login_failure_spike")).toHaveLength(1);
    // The bucket itself stops one past the threshold: a flood cannot grow it.
    expect(await siteTally()).toBe(limits.FAILED_SIGN_IN_ALERT_THRESHOLD + 1);
  });

  it("rings once, not once per server, when the failures arrive together", async () => {
    // Every instance bumps the same row; exactly one of them lands on the maximum.
    await fail(250);

    expect(await queued("login_failure_spike")).toHaveLength(1);
  });

  it("rings again in the next hour if it is still going", async () => {
    await fail(limits.FAILED_SIGN_IN_ALERT_THRESHOLD + 20);
    expect(await queued("login_failure_spike")).toHaveLength(1);

    // An hour later, on the database's clock and on this server's.
    await pg.exec("UPDATE rate_limit_buckets SET reset_at = now() - interval '1 second'");
    const later = Date.now() + limits.FAILED_SIGN_IN_ALERT_WINDOW_MS + 1_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    alerts.resetAlertThrottle();

    await fail(limits.FAILED_SIGN_IN_ALERT_THRESHOLD - 1);
    expect(await siteTally()).toBe(limits.FAILED_SIGN_IN_ALERT_THRESHOLD - 1);
    expect(await queued("login_failure_spike")).toHaveLength(1);

    await fail(1);
    expect(await queued("login_failure_spike")).toHaveLength(2);
  });

  it("keeps quiet until the window has really ended, not merely until asked again", async () => {
    await fail(limits.FAILED_SIGN_IN_ALERT_THRESHOLD);
    const execute = vi.spyOn(database, "execute");

    // One minute short of the hour: still the same window.
    const almost = Date.now() + limits.FAILED_SIGN_IN_ALERT_WINDOW_MS - 60_000;
    vi.spyOn(Date, "now").mockReturnValue(almost);
    await attempts.countFailedSignIn({ reason: "throttled" }, null);

    expect(execute).not.toHaveBeenCalled();
  });

  it("asks a store that failed again: one dropped connection must not silence the hour", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.db = { execute: async () => { throw new Error("connection reset"); } };
    await attempts.countFailedSignIn({ reason: "throttled" }, null);

    mocks.db = database;
    await attempts.countFailedSignIn({ reason: "throttled" }, null);

    expect(await siteTally()).toBe(1);
  });

  it("counts what the routes refuse, whatever the reason", async () => {
    await signIn("ada@example.test", "wrong");
    await signIn("nobody@example.test", "wrong");
    await signIn("closed@example.test", PASSWORD);
    await flush();

    expect(await siteTally()).toBe(3);
  });

  it("knows which bump reached the threshold", () => {
    const at = (remaining: number, allowed: boolean, unavailable?: boolean) =>
      attempts.reachedThreshold({ allowed, remaining, resetTime: Date.now() + 1_000, unavailable });

    expect(at(5, true)).toBe(false);
    expect(at(1, true)).toBe(false);
    expect(at(0, true)).toBe(true);
    // Past it: already reported.
    expect(at(0, false)).toBe(false);
    // The store failing reports "refused with nothing left": that is not a count.
    expect(at(0, false, true)).toBe(false);
  });
});

describe("wrong two-factor codes after a correct password", () => {
  /** A code that is certainly wrong: not one of the three the server would accept. */
  function wrongCode(secret: string): string {
    const step = totp.currentStep();
    const valid = new Set([-2, -1, 0, 1, 2].map((delta) => totp.totpAt(secret, step + delta)));
    for (let candidate = 0; candidate < 1_000_000; candidate += 1) {
      const code = String(candidate).padStart(6, "0");
      if (!valid.has(code)) return code;
    }
    throw new Error("unreachable");
  }

  async function enrol(userId: string, email: string) {
    const started = await twoFactor.beginEnrolment(userId, email);
    if (!started.ok) throw new Error("enrolment did not start");
    const confirmed = await twoFactor.confirmEnrolment(userId, totp.totpAt(started.secret, totp.currentStep()));
    if (!confirmed.ok) throw new Error("enrolment was not confirmed");
    return wrongCode(started.secret);
  }

  /** Wrong codes, five to a challenge — which is all a challenge allows. */
  async function guess(userId: string, code: string, count: number) {
    const statuses: number[] = [];
    let challenge = "";
    for (let attempt = 0; attempt < count; attempt += 1) {
      if (attempt % twoFactor.MAX_CHALLENGE_ATTEMPTS === 0) challenge = (await twoFactor.createChallenge(userId)).token;
      statuses.push((await submitCode(challenge, code)).status);
    }
    await flush();
    return statuses;
  }

  it("each one is logged against the account", async () => {
    const code = await enrol(ADA, "ada@example.test");

    const statuses = await guess(ADA, code, 1);

    expect(statuses).toEqual([401]);
    expect(failures()).toHaveLength(1);
    expect(failures()[0].context).toEqual({
      reason: "wrong_second_factor",
      userId: ADA,
      network: fraud.hashSignal(IP),
    });
    expect(failures()[0].line).not.toContain(code);
  });

  it("ten in an hour tell the operator the password is known", async () => {
    mailAndWebhookConfigured();
    const code = await enrol(ADA, "ada@example.test");

    const statuses = await guess(ADA, code, limits.SECOND_FACTOR_FAILURE_ALERT_THRESHOLD - 1);
    expect(statuses.every((status) => status === 401)).toBe(true);
    expect(await queued("second_factor_guessing")).toHaveLength(0);

    await pg.exec("UPDATE two_factor_challenges SET attempts = 0, consumed_at = NULL");
    const last = (await twoFactor.createChallenge(ADA)).token;
    await submitCode(last, code);
    await flush();

    const rows = await queued("second_factor_guessing");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: ADA, severity: "high", ipHash: fraud.hashSignal(IP) });
    expect(rows[0].reasons).toContain("10 wrong two-factor codes within an hour");

    // Mailed, unlike a lockout: nobody gets this far without the password.
    const mail = sent("https://api.resend.com/emails");
    expect(mail).toHaveLength(1);
    const message = JSON.parse(String((mail[0][1] as RequestInit).body)) as { subject: string; html: string };
    expect(message.subject).toContain("Two-factor guessing");
    expect(message.html).toContain("ada@example.test");

    // And once: the eleventh and twelfth add nothing.
    await submitCode(last, code);
    await submitCode(last, code);
    await flush();
    expect(await queued("second_factor_guessing")).toHaveLength(1);
    expect(sent("https://api.resend.com/emails")).toHaveLength(1);
  });

  it("is counted per account, so one customer's typos are not another's alert", async () => {
    const adaCode = await enrol(ADA, "ada@example.test");
    const graceCode = await enrol(GRACE, "grace@example.test");

    await guess(ADA, adaCode, 5);
    await guess(GRACE, graceCode, 5);

    expect(await queued("second_factor_guessing")).toHaveLength(0);
    // Both still count towards the site-wide picture.
    expect(await siteTally()).toBe(10);
  });

  it("does not count a code that was right", async () => {
    const started = await twoFactor.beginEnrolment(ADA, "ada@example.test");
    if (!started.ok) throw new Error("enrolment did not start");
    const step = totp.currentStep();
    await twoFactor.confirmEnrolment(ADA, totp.totpAt(started.secret, step));
    const challenge = (await twoFactor.createChallenge(ADA)).token;

    // The next step's code: inside the tolerance, and not the one enrolment used.
    const response = await submitCode(challenge, totp.totpAt(started.secret, step + 1));
    await flush();

    expect(response.status).toBe(200);
    expect(failures()).toHaveLength(0);
    expect(await siteTally()).toBe(0);
  });
});

describe("what the operator reads", () => {
  it("has a label in the queue for each sign-in signal", async () => {
    const queue = await readFile("src/app/admin/(console)/security/FraudQueue.tsx", "utf8");
    for (const kind of ["login_lockout", "second_factor_guessing", "login_failure_spike"]) {
      expect(queue).toContain(`${kind}:`);
    }
  });

  it("gets an email that names the signal for the two that are mailed", async () => {
    const { fraudAlertEmail } = await import("@/lib/email/email-templates");
    const subjects = ["login_failure_spike", "second_factor_guessing", "something_unknown"].map(
      (kind) => fraudAlertEmail({ kind, severity: "high", reasons: ["a reason"] }).subject,
    );

    expect(new Set(subjects).size).toBe(3);
    expect(subjects[0]).toContain("Sign-in attack");
    expect(subjects[1]).toContain("Two-factor guessing");
  });

  it("writes reasons the alert email can list one per line", async () => {
    // The queue stores reasons joined by "; " and the email splits on ";": a
    // reason with a semicolon in it would be cut in half.
    const source = await readFile("src/lib/identity/login-attempts.ts", "utf8");
    const reasons = [...source.matchAll(/reasons: \[([\s\S]*?)\],\n/g)].map((match) => match[1]);

    expect(reasons).toHaveLength(3);
    for (const block of reasons) expect(block).not.toContain(";");
  });
});
