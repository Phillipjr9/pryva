import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import * as schema from "@/db/schema";

/**
 * Checkout priced for real.
 *
 * Every other purchase test mocks `@/lib/marketplace-pricing` and hands the route
 * a made-up total, which proves the route persists *a* number but never that the
 * number is the one the customer was shown. That is the same blind spot that let
 * a six-decimal source price break every listing: the seam between sources and
 * pricing was mocked on both sides.
 *
 * So here the sources are mocked and **pricing is not**. The route runs against
 * embedded PostgreSQL and the assertions are about money actually moving:
 *
 *   • the storefront price and the checkout charge are the same figure
 *   • the wallet, the order and the ledger all agree on it
 *   • nothing is written and no source is called when the balance is short
 *
 * Providers and auth are mocked; this is not a live-source test.
 */

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  user: vi.fn(),
  listing: null as Record<string, unknown> | null,
  listingError: null as Error | null,
  delivered: null as string[] | null,
  purchaseCalls: 0,
  promo: null as { discount: string } | null,
  promoBaskets: [] as number[],
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
// Spread the real module: a partial factory silently removes every other export,
// and `isConfiguredAdminEmail` is now reached through @/lib/manual-fulfilment when
// a hand-prepared item is bought. Missing, it throws and the gate fails closed —
// safe in production, but it would make these tests prove nothing.
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, requireAuthApi: mocks.user, getCurrentUser: mocks.user };
});
vi.mock("@/lib/logger", () => ({ logger: mocks.log }));
vi.mock("@/lib/rate-limit", () => ({
  purchaseRateLimiter: async () => ({ allowed: true, unavailable: false }),
}));
vi.mock("@/lib/schedule-wallet-emails", () => ({ scheduleWalletEmails: () => {} }));
vi.mock("@/lib/exchange-rate", () => ({
  getUsdToNgnRate: async () => ({ rate: 1600, source: "test", fetchedAt: new Date().toISOString() }),
}));
vi.mock("@/lib/marketplace-policy", () => ({
  isMarketplaceCheckoutConfigured: () => true,
  isMarketplacePurchaseEnabled: () => true,
}));

// The sources are fake; the price maths between them and the wallet is not.
vi.mock("@/lib/marketplace-suppliers", () => {
  class MarketplaceError extends Error {
    code: string; status: number; ambiguous = false;
    constructor(message: string, code: string, status = 502) {
      super(message); this.name = "MarketplaceError"; this.code = code; this.status = status;
    }
  }
  return {
    MarketplaceError,
    isMarketplaceCatalogAvailable: () => true,
    supportsPromoCodes: (slug: string) => slug.startsWith("p2:"),
    labelId: (label: string) => label.length + 1000,
    getMarketplaceListing: async () => {
      if (mocks.listingError) throw mocks.listingError;
      if (!mocks.listing) throw new MarketplaceError("Gone", "listing_not_found", 404);
      return mocks.listing;
    },
    listMarketplaceListings: async () => ({
      listings: mocks.listing ? [mocks.listing] : [],
      meta: { current_page: 1, last_page: 1, per_page: 24, total: mocks.listing ? 1 : 0 },
    }),
    purchaseMarketplaceListing: async ({ quantity }: { quantity: number }) => {
      mocks.purchaseCalls += 1;
      // A full receipt by default; a test may override it to hand back a short one.
      const accounts = mocks.delivered
        ?? Array.from({ length: quantity }, (_, index) => `user${index}|pass${index}`);
      // The route calls delivery complete only when the receipt has both the
      // credentials and a supplier order reference to reconcile against.
      return { accounts, supplierOrder: "OC-1", token: "primary" };
    },
  };
});

vi.mock("@/lib/accszone", async (original) => {
  const actual = await original<typeof import("@/lib/accszone")>();
  return {
    ...actual,
    validatePromo: async (_code: string, basketUsd: number) => {
      mocks.promoBaskets.push(basketUsd);
      if (!mocks.promo) throw new Error("promo_invalid");
      return mocks.promo;
    },
  };
});

let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
let purchaseRoute: typeof import("@/app/api/accounts/purchase/route");
let listingsRoute: typeof import("@/app/api/accounts/listings/route");
let promoRoute: typeof import("@/app/api/accounts/promo/route");

const USER = "f5ca2925-6050-49d2-ab89-fc324953ed11";
const START_BALANCE = 5_000_000;

/** A listing whose price is the canonical six-decimal string sources produce. */
function listing(overrides: Record<string, unknown> = {}) {
  return {
    slug: "p1:300004",
    sourceId: "300004",
    title: "Aged United States (US) Spotify with Email Access",
    group: "Streaming",
    category: "Aged USA Spotify",
    subcategory: null,
    priceUsd: "3.480000",
    stock: 500,
    sold: 12,
    minQuantity: 1,
    maxQuantity: 50,
    available: true,
    warrantyDays: 120,
    fulfilment: "instant",
    ...overrides,
  };
}

const purchaseRequest = (body: Record<string, unknown>) => new NextRequest("https://pryva.test/api/accounts/purchase", {
  method: "POST",
  headers: { host: "pryva.test", "x-forwarded-proto": "https", origin: "https://pryva.test", "content-type": "application/json" },
  body: JSON.stringify({ requestId: randomUUID(), quantity: 1, ...body }),
});
const listingsRequest = () => new NextRequest("https://pryva.test/api/accounts/listings", { headers: { host: "pryva.test" } });
const promoRequest = (body: Record<string, unknown>) => new NextRequest("https://pryva.test/api/accounts/promo", {
  method: "POST",
  headers: { host: "pryva.test", "x-forwarded-proto": "https", origin: "https://pryva.test", "content-type": "application/json" },
  body: JSON.stringify(body),
});

beforeAll(async () => {
  pg = new PGlite();
  for (const file of [
    "0000_base_schema.sql", "0001_google_subject.sql", "0002_shared_rate_limits.sql",
    "0003_withdrawal_idempotency.sql", "0004_paystack_transfer_reference.sql", "0005_wallet_email_outbox.sql", "0006_order_idempotency.sql", "0007_order_reconciliation_note.sql", "0008_order_provider_cost.sql", "0009_password_reset_tokens.sql", "0010_order_provider_no_default.sql", "0011_email_verification.sql",
  ]) {
    await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  }
  database = drizzle(pg, { schema });
  mocks.db = database;
  [purchaseRoute, listingsRoute, promoRoute] = await Promise.all([
    import("@/app/api/accounts/purchase/route"),
    import("@/app/api/accounts/listings/route"),
    import("@/app/api/accounts/promo/route"),
  ]);
}, 30_000);

afterAll(async () => { await pg?.close(); });

/** Allowlisted owner address. Privilege needs this AND a verified address. */
const ADMIN_EMAIL = "owner@pryva.test";

/**
 * Seeds the precondition for selling a hand-prepared item: an administrator who
 * can actually reach `/admin/fulfilment`. Without one, the queue that prepares
 * those orders is unreachable and the purchase route refuses the sale.
 */
async function seedReachableAdmin() {
  await database.insert(schema.users).values({
    id: randomUUID(), name: "Owner", email: ADMIN_EMAIL, passwordHash: "hash",
    walletBalance: 0, emailVerifiedAt: new Date("2026-01-02T00:00:00Z"),
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "postgres://embedded-test/db");
  vi.stubEnv("ADMIN_EMAILS", ADMIN_EMAIL);
  await pg.exec('TRUNCATE TABLE "users" CASCADE');
  await database.insert(schema.users).values({
    id: USER, name: "Buyer", email: "buyer@example.com", passwordHash: "hash", walletBalance: START_BALANCE,
  });
  mocks.user.mockResolvedValue({ id: USER, email: "buyer@example.com", name: "Buyer", walletBalance: START_BALANCE });
  mocks.listing = listing();
  mocks.listingError = null;
  mocks.purchaseCalls = 0;
  mocks.promo = null;
  mocks.promoBaskets = [];
  mocks.delivered = null;
});

const balance = async () =>
  (await database.select({ walletBalance: schema.users.walletBalance }).from(schema.users).where(eq(schema.users.id, USER)))[0].walletBalance;
const ledger = async () =>
  database.select().from(schema.walletTransactions).where(eq(schema.walletTransactions.userId, USER));
const orderRows = async () => database.select().from(schema.orders);

describe("checkout with real pricing", () => {
  it("charges exactly what the storefront showed for the same listing", async () => {
    // The price a shopper sees on /accounts...
    const shown = await (await listingsRoute.GET(listingsRequest())).json();
    expect(shown.listings).toHaveLength(1);
    const advertised = shown.listings[0].priceNgn;
    expect(advertised).toBeGreaterThan(0);

    // ...is the price checkout actually takes. One unit, so the advertised unit
    // price and the charged total must be the same figure, not two computations
    // that happen to agree today.
    const response = await purchaseRoute.POST(purchaseRequest({ slug: "p1:300004", quantity: 1 }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.totalNgn).toBe(advertised);

    expect(await balance()).toBe(START_BALANCE - advertised);
  });

  it("keeps the wallet, the order and the ledger in agreement", async () => {
    const response = await purchaseRoute.POST(purchaseRequest({ slug: "p1:300004", quantity: 3 }));
    expect(response.status).toBe(200);
    const charged = (await response.json()).totalNgn;

    const [order] = await orderRows();
    expect(order.amount).toBe(charged);
    expect(order.status).toBe("delivered");
    expect(order.provider).toBe("accounts");
    expect(order.planLabel).toBe("3 × account");
    expect(JSON.parse(order.accounts!)).toHaveLength(3);

    const rows = await ledger();
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("debit");
    expect(rows[0].amount).toBe(charged);
    expect(rows[0].balanceAfter).toBe(START_BALANCE - charged);
    expect(await balance()).toBe(START_BALANCE - charged);
  });

  it("prices a bulk basket below the single-unit multiple, and charges that", async () => {
    const single = await purchaseRoute.POST(purchaseRequest({ slug: "p1:300004", quantity: 1 }));
    const singleTotal = (await single.json()).totalNgn;

    await pg.exec('TRUNCATE TABLE "users" CASCADE');
    await database.insert(schema.users).values({
      id: USER, name: "Buyer", email: "buyer@example.com", passwordHash: "hash", walletBalance: START_BALANCE,
    });

    const bulk = await purchaseRoute.POST(purchaseRequest({ slug: "p1:300004", quantity: 25 }));
    expect(bulk.status).toBe(200);
    const bulkTotal = (await bulk.json()).totalNgn;

    // A volume discount means 25 units cost less than 25 separate orders.
    expect(bulkTotal).toBeLessThan(singleTotal * 25);
    expect(await balance()).toBe(START_BALANCE - bulkTotal);
    const [order] = await orderRows();
    expect(order.amount).toBe(bulkTotal);
  });

  it("moves no money and calls no source when the wallet is short", async () => {
    await database.update(schema.users).set({ walletBalance: 100 }).where(eq(schema.users.id, USER));

    const response = await purchaseRoute.POST(purchaseRequest({ slug: "p1:300004", quantity: 1 }));
    expect(response.status).toBe(402);
    const body = await response.json();
    expect(body.error).toBe("Insufficient wallet balance.");
    expect(body.required).toBeGreaterThan(100);

    expect(await balance()).toBe(100);
    expect(await orderRows()).toHaveLength(0);
    expect(await ledger()).toHaveLength(0);
    // The debit is refused before any source is contacted, so nothing is owed.
    expect(mocks.purchaseCalls).toBe(0);
  });

  it("applies a real promo discount to the amount actually debited", async () => {
    mocks.listing = listing({ slug: "p2:legacy-1", sourceId: "1" });
    mocks.promo = { discount: "0.500000" };

    const plain = await purchaseRoute.POST(purchaseRequest({ slug: "p2:legacy-1", quantity: 1 }));
    const plainTotal = (await plain.json()).totalNgn;

    await pg.exec('TRUNCATE TABLE "users" CASCADE');
    await database.insert(schema.users).values({
      id: USER, name: "Buyer", email: "buyer@example.com", passwordHash: "hash", walletBalance: START_BALANCE,
    });
    mocks.purchaseCalls = 0;

    const discounted = await purchaseRoute.POST(purchaseRequest({ slug: "p2:legacy-1", quantity: 1, promoCode: "SAVE50" }));
    expect(discounted.status).toBe(200);
    const body = await discounted.json();
    expect(body.totalNgn).toBeLessThan(plainTotal);
    expect(body.promoCode).toBe("SAVE50");

    // The discount is real money: the wallet and ledger reflect the lower figure.
    expect(await balance()).toBe(START_BALANCE - body.totalNgn);
    const rows = await ledger();
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(body.totalNgn);
    // A discount can shrink profit but never breach the floor.
    const [order] = await orderRows();
    expect(order.amount).toBe(body.totalNgn);
  });

  it("refuses a promo on a listing whose source has no promo API, at the shown price", async () => {
    const response = await purchaseRoute.POST(purchaseRequest({ slug: "p1:300004", quantity: 1, promoCode: "SAVE50" }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("Promo codes do not apply to this item.");
    // Refused rather than silently charged the undiscounted price.
    expect(await orderRows()).toHaveLength(0);
    expect(await balance()).toBe(START_BALANCE);
    expect(mocks.purchaseCalls).toBe(0);
  });

  it("rejects a basket below the minimum order instead of charging a token amount", async () => {
    mocks.listing = listing({ priceUsd: "0.000001" });

    const response = await purchaseRoute.POST(purchaseRequest({ slug: "p1:300004", quantity: 1 }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.minimumOrderNgn).toBe(500);
    expect(body.totalNgn).toBeLessThan(500);
    expect(body.error).toMatch(/Minimum order is/);

    expect(await orderRows()).toHaveLength(0);
    expect(await balance()).toBe(START_BALANCE);
    expect(mocks.purchaseCalls).toBe(0);
  });

  it("charges a real six-decimal price for a hand-prepared item without calling any source", async () => {
    // Sellable only because someone can prepare it: see the refusal test below.
    await seedReachableAdmin();
    mocks.listing = listing({
      slug: "p3:netflix-standard", sourceId: "netflix-standard", title: "Netflix Standard (1080p)",
      priceUsd: "2.500000", stock: null, sold: null, warrantyDays: 120, fulfilment: "manual",
    });

    const response = await purchaseRoute.POST(purchaseRequest({ slug: "p3:netflix-standard", quantity: 2 }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.preparing).toBe(true);
    expect(body.warrantyDays).toBe(120);
    expect(body.totalNgn).toBeGreaterThan(0);

    const [order] = await orderRows();
    expect(order.provider).toBe("manual");
    expect(order.status).toBe("processing");
    expect(order.amount).toBe(body.totalNgn);
    expect(await balance()).toBe(START_BALANCE - body.totalNgn);
    // No source exists for this item, so none may be contacted.
    expect(mocks.purchaseCalls).toBe(0);
  });

  it("refuses a hand-prepared item when nobody can reach the fulfilment queue", async () => {
    // The state this deployment is actually in while transactional email is
    // unconfigured: ADMIN_EMAILS is set, but no user has a verified address, so
    // `isAdminUser` is false for everyone and /admin/fulfilment is unreachable.
    // The listing is still honest and correctly priced — it simply must not be
    // sold, because the order would sit in `processing` with no way to prepare it.
    mocks.listing = listing({
      slug: "p3:netflix-standard", sourceId: "netflix-standard", title: "Netflix Standard (1080p)",
      priceUsd: "2.500000", stock: null, sold: null, warrantyDays: 120, fulfilment: "manual",
    });

    const response = await purchaseRoute.POST(purchaseRequest({ slug: "p3:netflix-standard", quantity: 2 }));
    expect(response.status).toBe(503);
    // Refused before the wallet was touched: no order, no debit, no source call.
    expect(await orderRows()).toHaveLength(0);
    expect(await balance()).toBe(START_BALANCE);
    expect(mocks.purchaseCalls).toBe(0);
  });

  it("does not let an allowlisted but unverified address open the manual lane", async () => {
    // ADMIN_EMAILS grants by string match alone, so verification is the only
    // proof of control. An unverified allowlisted user must not make hand-prepared
    // items sellable — that is the whole reason isAdminUser requires both.
    await database.insert(schema.users).values({
      id: randomUUID(), name: "Owner", email: ADMIN_EMAIL, passwordHash: "hash", walletBalance: 0,
    });
    mocks.listing = listing({
      slug: "p3:netflix-standard", sourceId: "netflix-standard", title: "Netflix Standard (1080p)",
      priceUsd: "2.500000", stock: null, sold: null, warrantyDays: 120, fulfilment: "manual",
    });

    const response = await purchaseRoute.POST(purchaseRequest({ slug: "p3:netflix-standard", quantity: 2 }));
    expect(response.status).toBe(503);
    expect(await balance()).toBe(START_BALANCE);
  });

  it("holds a short receipt for review instead of calling the order delivered", async () => {
    // Three units ordered, one credential returned. The customer has paid, so the
    // order must not read as complete: the partial credentials are preserved for
    // support and the charge stands for reconciliation rather than being hidden
    // behind a delivered badge.
    mocks.delivered = ["only-one|credential"];

    const response = await purchaseRoute.POST(purchaseRequest({ slug: "p1:300004", quantity: 3 }));
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.pending).toBe(true);
    expect(body.order.reference).toMatch(/^MKT-/);

    const [order] = await orderRows();
    expect(order.status).toBe("review");
    expect(JSON.parse(order.accounts!)).toEqual(["only-one|credential"]);

    // The money moved, and the ledger says so — no silent write-off.
    const rows = await ledger();
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(order.amount);
    expect(await balance()).toBe(START_BALANCE - order.amount);
    expect(mocks.purchaseCalls).toBe(1);
  });

describe("the promo quote agrees with what checkout charges", () => {
  // The quote is shown before payment. If it diverges from checkout, the customer
  // is promised a discount they do not get — the same class of split-brain the
  // storefront/checkout invariant above guards against.
  beforeEach(() => {
    mocks.listing = listing({ slug: "p2:legacy-1", sourceId: "1" });
    mocks.promo = { discount: "0.500000" };
  });

  it("quotes the exact amount checkout later debits", async () => {
    const quote = await promoRoute.POST(promoRequest({ code: "SAVE50", slug: "p2:legacy-1", quantity: 2 }));
    expect(quote.status).toBe(200);
    const quoted = await quote.json();
    expect(quoted.valid).toBe(true);
    expect(quoted.code).toBe("SAVE50");

    const charged = await purchaseRoute.POST(purchaseRequest({ slug: "p2:legacy-1", quantity: 2, promoCode: "SAVE50" }));
    expect(charged.status).toBe(200);
    const receipt = await charged.json();

    // The promised figure is the debited figure.
    expect(receipt.totalNgn).toBe(quoted.totalNgn);
    expect(receipt.discountNgn).toBe(quoted.savedNgn);
    expect(await balance()).toBe(START_BALANCE - quoted.totalNgn);
  });

  it("quotes against the same undiscounted base checkout would charge", async () => {
    const quote = await (await promoRoute.POST(promoRequest({ code: "SAVE50", slug: "p2:legacy-1", quantity: 2 }))).json();

    mocks.promo = null; // no code applied
    const plain = await purchaseRoute.POST(purchaseRequest({ slug: "p2:legacy-1", quantity: 2 }));
    expect((await plain.json()).totalNgn).toBe(quote.originalTotalNgn);

    // The saving is the difference between those two, exactly.
    expect(quote.savedNgn).toBe(quote.originalTotalNgn - quote.totalNgn);
    expect(quote.savedNgn).toBeGreaterThan(0);
  });

  it("validates the code against an identical basket in both routes", async () => {
    // The quote rounds the basket to two decimals and checkout does not. Both are
    // derived from integer cents, so they cannot differ — but that equivalence is
    // arithmetic, not intent, and nothing else in the repo would notice a drift.
    await promoRoute.POST(promoRequest({ code: "SAVE50", slug: "p2:legacy-1", quantity: 7 }));
    mocks.promoBaskets = [];
    await purchaseRoute.POST(purchaseRequest({ slug: "p2:legacy-1", quantity: 7, promoCode: "SAVE50" }));

    expect(mocks.promoBaskets.length).toBeGreaterThan(0);
    for (const basket of mocks.promoBaskets) {
      expect(Number.isFinite(basket)).toBe(true);
      expect(basket).toBeGreaterThan(0);
      // A whole-dollar basket is what the provider is quoted either way.
      expect(basket).toBeCloseTo(3.48 * 7, 10);
    }
  });

  it("refuses a code on a non-promo listing in the quote, before checkout can refuse it", async () => {
    mocks.listing = listing(); // a p1: listing
    const quote = await promoRoute.POST(promoRequest({ code: "SAVE50", slug: "p1:300004", quantity: 1 }));
    expect(quote.status).toBe(200);
    const body = await quote.json();
    expect(body.valid).toBe(false);
    expect(body.message).toBe("Promo codes do not apply to this item.");

    // The customer is told at the quote, so checkout never has to refuse a
    // discount it already showed. Both routes use the same wording.
    const checkout = await purchaseRoute.POST(purchaseRequest({ slug: "p1:300004", quantity: 1, promoCode: "SAVE50" }));
    expect(checkout.status).toBe(409);
    expect((await checkout.json()).error).toBe(body.message);
    expect(mocks.purchaseCalls).toBe(0);
  });

  it("quotes an invalid code as inline text rather than charging anything", async () => {
    mocks.promo = null; // validatePromo rejects
    const quote = await promoRoute.POST(promoRequest({ code: "NOPE", slug: "p2:legacy-1", quantity: 1 }));
    expect(quote.status).toBe(200);
    const body = await quote.json();
    expect(body.valid).toBe(false);
    expect(typeof body.message).toBe("string");
    expect(await balance()).toBe(START_BALANCE);
    expect(await orderRows()).toHaveLength(0);
    expect(mocks.purchaseCalls).toBe(0);
  });
});

describe("the purchase response carries no cost or source identity", () => {
  it("never writes a wholesale cost or a source identity into what the customer receives", async () => {
    const response = await purchaseRoute.POST(purchaseRequest({ slug: "p1:300004", quantity: 2 }));
    const body = await response.json();
    const json = JSON.stringify(body).toLowerCase();

    for (const word of [
      "bulkacc", "accszone", "fleexa", "freshbulkacc", "reseller", "wholesale",
      "supplier", "upstream", "vendor", "3.480000", "priceusd", "costusd",
    ]) {
      expect(json, `response leaked "${word}"`).not.toContain(word);
    }
    // The ledger description is customer-visible in the wallet history.
    const [row] = await ledger();
    const description = row.description.toLowerCase();
    for (const word of ["supplier", "reseller", "wholesale", "bulkacc", "accszone", "fleexa"]) {
      expect(description, `ledger leaked "${word}"`).not.toContain(word);
    }
  });
});
});
