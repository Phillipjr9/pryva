import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";

import * as schema from "@/db/schema";
import { fraudEvents, users } from "@/db/schema";
import { fraudAlertEmail } from "@/lib/email-templates";

/**
 * Fraud alert emails.
 *
 * Two questions. Does the message say only what an operator needs — the signal,
 * the severity, the account, and the reasons, with no thresholds and no raw
 * network address? And can it be trusted not to break a money path: unconfigured
 * mail is a quiet no-op, a repeat inside the window is suppressed, and a failing
 * mail API resolves `false` instead of throwing?
 */

const mocks = vi.hoisted(() => ({ db: undefined as unknown, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/logger", () => ({ logger: mocks.log }));

const USER = "11111111-1111-4111-8111-111111111111";

let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
let alerts: typeof import("@/lib/fraud-alerts");

const ENV_KEYS = ["RESEND_API_KEY", "RESEND_FROM_EMAIL", "FRAUD_ALERT_EMAIL", "ADMIN_EMAILS"] as const;
let savedEnv: Record<string, string | undefined>;

beforeAll(async () => {
  pg = new PGlite();
  const files = (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  database = drizzle(pg, { schema });
  mocks.db = database;
  alerts = await import("@/lib/fraud-alerts");
}, 30_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  await database.execute(sql`TRUNCATE TABLE fraud_events, users CASCADE`);
  await database.insert(users).values({
    id: USER,
    name: "Ada",
    email: "ada@example.com",
    passwordHash: "x",
    walletBalance: 0,
  });
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.unstubAllGlobals();
});

async function queueEvent(overrides: Partial<typeof fraudEvents.$inferInsert> = {}) {
  const [row] = await database
    .insert(fraudEvents)
    .values({
      userId: USER,
      kind: "withdrawal_review",
      severity: "high",
      reasons: "account is 2 days old; payout account added 4 hours ago",
      amount: 25_000,
      ...overrides,
    })
    .returning({ id: fraudEvents.id });
  return row!.id;
}

function mailConfigured() {
  process.env.RESEND_API_KEY = "re_test";
  process.env.RESEND_FROM_EMAIL = "Pryva <no-reply@pryva.ng>";
  process.env.FRAUD_ALERT_EMAIL = "security@pryva.ng";
}

describe("fraud alert template", () => {
  it("carries its own 3D hero, not a receipt image", () => {
    const template = fraudAlertEmail({ kind: "withdrawal_review", severity: "high", reasons: ["account is 2 days old"] });
    expect(template.html).toContain("/images/email/hero-fraud.jpg");
    expect(template.html).not.toContain("hero-wallet.jpg");
    expect(template.html).not.toContain("hero-order.jpg");
    // Same card shell as every other email: gradient bar, 600px card, dark CTA.
    expect(template.html).toContain("height:5px");
    expect(template.html).toContain('width="600"');
    expect(template.html).toContain("#29223a");
  });

  it("has a subject, a preheader and a plain-text fallback for every signal", () => {
    for (const kind of [
      "withdrawal_review",
      "withdrawal_velocity",
      "referral_same_network",
      "purchase_velocity",
      "gift_card_velocity",
      "something_new",
    ]) {
      const template = fraudAlertEmail({ kind, severity: "high", reasons: ["a reason"] });
      expect(template.subject.length).toBeGreaterThan(10);
      expect(template.preheader?.length).toBeGreaterThan(10);
      expect(template.text).toContain("a reason");
      expect(template.text).toContain("/admin/security");
      expect(template.html).toContain("/admin/security");
    }
  });

  it("names the signal rather than falling back for a known kind", () => {
    const headings = new Set(
      ["withdrawal_review", "referral_same_network", "purchase_velocity", "gift_card_velocity"].map(
        (kind) => fraudAlertEmail({ kind, severity: "high", reasons: ["x"] }).subject,
      ),
    );
    expect(headings.size).toBe(4);
  });

  it("shows the severity, the account and the reasons", () => {
    const template = fraudAlertEmail({
      kind: "withdrawal_review",
      severity: "high",
      reasons: ["account is 2 days old", "payout account never paid"],
      amount: 25_000,
      reference: "WD-1234",
      accountEmail: "ada@example.com",
    });
    expect(template.subject).toContain("high");
    expect(template.html).toContain("ada@example.com");
    expect(template.html).toContain("₦25,000");
    expect(template.html).toContain("WD-1234");
    expect(template.html).toContain("payout account never paid");
    expect(template.html).toContain("high");
  });

  it("never publishes a threshold or a network hash", async () => {
    const template = fraudAlertEmail({
      kind: "purchase_velocity",
      severity: "high",
      reasons: ["40 orders in the last hour"],
    });
    // The reason string is shown because a human wrote it, but the raw ip hash and
    // any interpolated fingerprint are not part of the template's inputs at all.
    expect(template.html).not.toMatch(/[0-9a-f]{64}/);
    expect(template.text).not.toMatch(/[0-9a-f]{64}/);
    expect(template.html).not.toContain("203.0.113");
    expect(template.text).not.toContain("203.0.113");
  });

  it("escapes a reason that contains markup", () => {
    const template = fraudAlertEmail({
      kind: "withdrawal_review",
      severity: "high",
      reasons: ["reference <script>alert(1)</script>"],
      accountEmail: "a<b@example.com",
    });
    expect(template.html).not.toContain("<script>");
    expect(template.html).toContain("&lt;script&gt;");
    expect(template.html).toContain("a&lt;b@example.com");
  });

  it("tells the operator the signal moved no money", () => {
    const template = fraudAlertEmail({ kind: "referral_same_network", severity: "high", reasons: ["same network"] });
    expect(template.html).toContain("never moves money on its own");
    expect(template.text).toContain("never moves money on its own");
  });
});

describe("fraud alert recipients", () => {
  it("prefers the dedicated security inbox", () => {
    expect(
      alerts.fraudAlertRecipients({
        FRAUD_ALERT_EMAIL: "security@pryva.ng, ops@pryva.ng",
        ADMIN_EMAILS: "owner@pryva.ng",
      } as unknown as NodeJS.ProcessEnv),
    ).toEqual(["security@pryva.ng", "ops@pryva.ng"]);
  });

  it("falls back to the admin gate's list", () => {
    expect(
      alerts.fraudAlertRecipients({ ADMIN_EMAILS: "Owner@Pryva.ng; owner@pryva.ng" } as unknown as NodeJS.ProcessEnv),
    ).toEqual(["owner@pryva.ng"]);
  });

  it("drops junk and caps the list", () => {
    const list = alerts.fraudAlertRecipients({
      FRAUD_ALERT_EMAIL: ["not-an-address", "a@b.co", "a@b.co", ...Array.from({ length: 9 }, (_, i) => `op${i}@pryva.ng`)].join(","),
    } as unknown as NodeJS.ProcessEnv);
    expect(list).toHaveLength(alerts.FRAUD_ALERT_MAX_RECIPIENTS);
    expect(list[0]).toBe("a@b.co");
    expect(list).not.toContain("not-an-address");
  });

  it("returns nothing when neither variable is set", () => {
    expect(alerts.fraudAlertRecipients({} as unknown as NodeJS.ProcessEnv)).toEqual([]);
  });

  it("only mails high severity", () => {
    expect(alerts.shouldEmailFraudEvent("high")).toBe(true);
    expect(alerts.shouldEmailFraudEvent("warn")).toBe(false);
    expect(alerts.shouldEmailFraudEvent("info")).toBe(false);
    expect(alerts.shouldEmailFraudEvent(null)).toBe(false);
  });
});

describe("fraud alert delivery", () => {
  it("sends nothing when mail is not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const id = await queueEvent();
    await expect(alerts.sendFraudAlertForEvent(id)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends one message to the configured operators", async () => {
    mailConfigured();
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const id = await queueEvent();

    await expect(alerts.sendFraudAlertForEvent(id)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const body = JSON.parse(String(init.body)) as {
      to: string[];
      subject: string;
      html: string;
      text: string;
      from: string;
    };
    expect(body.to).toEqual(["security@pryva.ng"]);
    expect(body.from).toContain("no-reply@pryva.ng");
    expect(body.subject.toLowerCase()).toContain("withdrawal");
    expect(body.html).toContain("hero-fraud.jpg");
    expect(body.html).toContain("ada@example.com");
    expect(body.text).toContain("payout account added 4 hours ago");
  });

  it("leaves warn events in the queue only", async () => {
    mailConfigured();
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const id = await queueEvent({ severity: "warn" });
    await expect(alerts.sendFraudAlertForEvent(id)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rings once per account and signal inside the window", async () => {
    mailConfigured();
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const first = await queueEvent();
    await expect(alerts.sendFraudAlertForEvent(first)).resolves.toBe(true);
    const second = await queueEvent();
    await expect(alerts.sendFraudAlertForEvent(second)).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A different signal on the same account is news, and still rings.
    const other = await queueEvent({ kind: "gift_card_velocity", reasons: "10 redemptions today" });
    await expect(alerts.sendFraudAlertForEvent(other)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rings again once the window has passed", async () => {
    mailConfigured();
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await queueEvent({ createdAt: new Date(Date.now() - alerts.FRAUD_ALERT_WINDOW_MS - 60_000) });
    const fresh = await queueEvent();
    await expect(alerts.sendFraudAlertForEvent(fresh)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("swallows a failing mail API", async () => {
    mailConfigured();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    const id = await queueEvent();
    await expect(alerts.sendFraudAlertForEvent(id)).resolves.toBe(false);
    expect(mocks.log.warn).toHaveBeenCalled();
  });

  it("sends nothing when there is nobody to mail", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESEND_FROM_EMAIL = "Pryva <no-reply@pryva.ng>";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const id = await queueEvent();
    await expect(alerts.sendFraudAlertForEvent(id)).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores an event id that does not exist", async () => {
    mailConfigured();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(alerts.sendFraudAlertForEvent("99999999-9999-4999-8999-999999999999")).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is reachable from recordFraudEvent without letting mail break the caller", async () => {
    mailConfigured();
    const fetchMock = vi.fn().mockRejectedValue(new Error("mail down"));
    vi.stubGlobal("fetch", fetchMock);
    const fraud = await import("@/lib/fraud");
    await expect(
      fraud.recordFraudEvent({ userId: USER, kind: "purchase_velocity", severity: "high", reasons: ["too many"] }),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
