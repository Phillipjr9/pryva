import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { renderToStaticMarkup } from "react-dom/server";
import { LoyaltyProgress } from "@/components/dashboard/LoyaltyProgress";

const mocks = vi.hoisted(() => ({ db: undefined as unknown, preview: false }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/platform/demo-policy", () => ({ isPreviewDatabase: () => mocks.preview }));
import { loyaltyStartAt, readLoyaltyProgress } from "@/lib/services/loyalty/progress";

let pg: PGlite;
const user = randomUUID(), other = randomUUID();
const start = "2026-01-01T00:00:00.000Z";
const now = new Date("2026-02-01T00:00:00.000Z");

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`CREATE TABLE orders (
    id uuid primary key, user_id uuid not null, service text not null, status text not null,
    amount integer not null, created_at timestamptz not null, refunded_at timestamptz,
    code_received_at timestamptz, duration text not null, provider_request_id text,
    reference_code text, esim_iccid text, esim_activation_code text, request_intent text
  ); CREATE TABLE wallet_transactions (
    id uuid primary key, order_id uuid, user_id uuid not null, type text not null, amount integer not null
  );`);
  mocks.db = drizzle(pg);
});
afterAll(async () => { await pg.close(); });
afterEach(async () => { vi.unstubAllEnvs(); mocks.preview = false; await pg.exec("TRUNCATE orders, wallet_transactions"); });

async function addOrder(input: { service?: string; status?: string; amount?: number; created?: string; refund?: boolean; debit?: boolean; owner?: string; duration?: string; code?: boolean; provider?: string; reference?: string; iccid?: string; activation?: string; requestIntent?: string } = {}) {
  const id = randomUUID(), owner = input.owner ?? user, amount = input.amount ?? 500;
  await pg.query(`INSERT INTO orders VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [id, owner, input.service ?? "accounts", input.status ?? "delivered", amount, input.created ?? start, input.refund ? now : null, input.code ? now : null, input.duration ?? "Instant", input.provider ?? null, input.reference ?? null, input.iccid ?? null, input.activation ?? null, input.requestIntent ?? null]);
  if (input.debit !== false) await pg.query(`INSERT INTO wallet_transactions VALUES ($1,$2,$3,'debit',$4)`, [randomUUID(), id, owner, amount]);
  return id;
}

describe("loyalty progress", () => {
  it("requires a precise fixed launch time and disables preview databases", async () => {
    expect(loyaltyStartAt(undefined)).toBeNull();
    expect(loyaltyStartAt("2026-01-01")).toBeNull();
    expect(loyaltyStartAt("2026-02-30T00:00:00.000Z")).toBeNull();
    expect(loyaltyStartAt(start)?.toISOString()).toBe(start);
    vi.stubEnv("LOYALTY_START_AT", start);
    mocks.preview = true;
    expect(await readLoyaltyProgress(user, now)).toBeNull();
    mocks.preview = false;
    expect(await readLoyaltyProgress(user, new Date("2025-12-31T23:59:59Z"))).toBeNull();
    vi.stubEnv("LOYALTY_START_AT", "");
    expect(await readLoyaltyProgress(user, now)).toBeNull();
  });

  it("counts paid, fulfilled post-launch purchases per unit and removes refunds", async () => {
    vi.stubEnv("LOYALTY_START_AT", start);
    const account = await addOrder();
    await addOrder({ amount: 499 });
    await addOrder({ created: "2025-12-31T23:59:59Z" });
    await addOrder({ created: "2026-03-01T00:00:00Z" });
    await addOrder({ owner: other });
    await addOrder({ debit: false });
    await addOrder({ status: "review" });
    await addOrder({ refund: true });
    await addOrder({ service: "numbers", status: "active" }); // no code yet
    await addOrder({ service: "numbers", status: "delivered", code: true });
    await addOrder({ service: "numbers", status: "expired", duration: "Rent for 7 days", provider: "rental-1", reference: "+123" });
    await addOrder({ service: "esim", status: "active", iccid: "iccid", activation: "activation" });
    await addOrder({ service: "esim", status: "active", iccid: " ", activation: "activation" });
    await addOrder({ service: "numbers", status: "active", duration: "Rent for 7 days", provider: " ", reference: "+123" });
    await addOrder({ service: "proxies", status: "active", provider: "" });
    await addOrder({ service: "social", status: "active", provider: "pending" });
    await addOrder({ service: "social", status: "delivered" });
    await addOrder({ service: "proxies", status: "active", provider: "confirmed" });
    await addOrder({ service: "email-otp", status: "delivered" }); // free/legacy
    await addOrder({ service: "data", status: "delivered" }); // not yet verified for this program
    // Multiple debit records cannot multiply an order's contribution.
    await pg.query(`INSERT INTO wallet_transactions VALUES ($1,$2,$3,'debit',500)`, [randomUUID(), account, user]);
    const first = await readLoyaltyProgress(user, now);
    expect(first).toMatchObject({ eligibleOrders: 6, current: { level: 2 }, next: { level: 3 }, remaining: 9 });
    await pg.query(`INSERT INTO wallet_transactions VALUES ($1,$2,$3,'refund',500)`, [randomUUID(), account, user]);
    expect(await readLoyaltyProgress(user, now)).toMatchObject({ eligibleOrders: 5, current: { level: 2 } });
    await pg.query(`UPDATE orders SET refunded_at=$1 WHERE id=$2`, [now, account]);
    expect(await readLoyaltyProgress(user, now)).toMatchObject({ eligibleOrders: 5 });
  });

  it("counts qualifying bulk units individually, with the minimum applied to each unit", async () => {
    vi.stubEnv("LOYALTY_START_AT", start);
    const requestIntent = `bulk:${randomUUID()}`;
    await addOrder({ service: "numbers", status: "delivered", code: true, amount: 500, requestIntent });
    await addOrder({ service: "numbers", status: "delivered", code: true, amount: 700, requestIntent });
    await addOrder({ service: "numbers", status: "delivered", code: true, amount: 499, requestIntent });
    await addOrder({ service: "numbers", status: "active", amount: 700, requestIntent });
    expect(await readLoyaltyProgress(user, now)).toMatchObject({ eligibleOrders: 2, current: { level: 1 }, remaining: 3 });
  });

  it("renders progress without promising live discounts", () => {
    expect(renderToStaticMarkup(<LoyaltyProgress progress={null} />)).toBe("");
    const markup = renderToStaticMarkup(<LoyaltyProgress progress={{ eligibleOrders: 6, current: { level: 2, minimumOrders: 5, discountBasisPoints: 50 }, next: { level: 3, minimumOrders: 15, discountBasisPoints: 100 }, remaining: 9 }} />);
    expect(markup).toContain("Level 2 of 5");
    expect(markup).toContain("9 more eligible orders");
    expect(markup).toContain("Discounts are not available yet");
    expect(markup).toContain('aria-valuenow="10"');
  });
});
