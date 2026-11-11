import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The number catalogue, read through the real gateway client against the
 * response shapes the gateway publishes (https://docs.bitcall.io/openapi/otp.json).
 *
 * The other catalogue tests mock our own client, so they pass or fail on what we
 * believe a response looks like. This file stubs only the network, with rows
 * copied from the published examples, because the two times the shop went empty
 * for every destination the code was reading a field those rows do not have:
 *
 *   * a service row is `{ name, slug, availableCount, price, poolCount, pools }`
 *     and names no country;
 *   * a destination is named only by the country catalogue (`countryCode`), and
 *     by the middle segment of an offer's own id (`CHARLIE-US-openai_/_chatgpt`).
 */

const KEY_ID = "ak_test_1a2b3c";
const SECRET = "a1".repeat(64);
const EUR_NGN = 1800;

function json(payload: unknown) {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

function euros(amount: number) {
  return { amount, currency: "EUR" };
}

/** A service row exactly as published: no country anywhere on it. */
function serviceRow(name: string, slug: string, pools: Array<{ serviceId: string; price: { amount: number; currency: string }; availableCount: number }>) {
  const amounts = pools.map((pool) => pool.price.amount);
  return {
    name,
    slug,
    availableCount: pools.reduce((total, pool) => total + pool.availableCount, 0),
    price: { min: Math.min(...amounts), max: Math.max(...amounts), average: amounts[0], currency: "EUR" },
    poolCount: pools.length,
    pools,
  };
}

const SERVICES = [
  serviceRow("OpenAI / ChatGPT", "openai-chatgpt", [
    { serviceId: "CHARLIE-US-openai_/_chatgpt", price: euros(1.0025), availableCount: 312 },
    { serviceId: "DELTA-CO-openai_/_chatgpt", price: euros(0.845001), availableCount: 18189030 },
  ]),
  serviceRow("Instagram", "instagram", [
    { serviceId: "DELTA-CO-instagram_/_threads", price: euros(0.845001), availableCount: 2736514 },
    { serviceId: "BRAVO-KG-instagram_/_threads", price: euros(0.845001), availableCount: 15769 },
  ]),
  serviceRow("adidas", "adidas", [
    { serviceId: "ALPHA-46-adidas", price: euros(0.336276), availableCount: 9999 },
    { serviceId: "DELTA-NG-adidas", price: euros(2.190105), availableCount: 23034 },
  ]),
  // A name that starts with two letters and a hyphen is still not a destination.
  serviceRow("US Mobile", "us-mobile", [
    { serviceId: "DELTA-CA-us_mobile", price: euros(0.9), availableCount: 40 },
  ]),
];

/** Country rows as published. `pools` is optional there, so both shapes occur. */
const COUNTRIES_WITHOUT_POOLS = [
  { countryCode: "JM_1", name: "Jamaica", flag: "https://flagcdn.com/48x36/jm.png", serviceCount: 62, startingPrice: euros(0.508725) },
  { countryCode: "US_1", name: "United States (Virtual)", flag: "https://flagcdn.com/48x36/us.png", serviceCount: 1270, startingPrice: euros(1.008828) },
  { countryCode: "NG_234", name: "Nigeria", flag: "https://flagcdn.com/48x36/ng.png", serviceCount: 310, startingPrice: euros(0.4) },
];

const COUNTRIES_WITH_POOLS = [
  {
    countryCode: "US_1", name: "United States (Virtual)", serviceCount: 1270, startingPrice: euros(1.008828), poolCount: 2,
    pools: [
      { serviceId: "CHARLIE-US-openai_/_chatgpt", price: euros(1.0025), availableCount: 312 },
      { serviceId: "BRAVO-US-telegram", price: euros(0.4), availableCount: 77 },
    ],
  },
  {
    countryCode: "NG_234", name: "Nigeria", serviceCount: 310, startingPrice: euros(0.4), poolCount: 1,
    pools: [{ serviceId: "DELTA-NG-whatsapp", price: euros(0.4), availableCount: 9 }],
  },
];

function gateway(countries: unknown[], services: unknown[] = SERVICES) {
  return vi.fn(async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    const meta = { page: 1, pageSize: 200, total: 0, totalPages: 1, hasNext: false };
    if (url.pathname === "/v1/otp/countries") return json({ data: countries, meta: { ...meta, total: countries.length } });
    if (url.pathname === "/v1/otp/services") return json({ data: services, meta: { ...meta, total: services.length } });
    throw new Error(`unexpected request to ${url.pathname}`);
  });
}

function requestsTo(fetchMock: ReturnType<typeof gateway>, pathname: string) {
  return fetchMock.mock.calls.filter(([input]) => new URL(String(input)).pathname === pathname);
}

async function load() {
  const suppliers = await import("@/lib/services/numbers/otp-suppliers");
  const catalog = await import("@/lib/services/numbers/otp-catalog");
  suppliers.clearOtpCatalogueCache();
  return { ...suppliers, ...catalog };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("BITCALL_KEY_ID", KEY_ID);
  vi.stubEnv("BITCALL_API_SECRET", SECRET);
  vi.stubEnv("BITCALL_API_URL", "");
  vi.stubEnv("EUR_NGN_RATE", String(EUR_NGN));
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the number catalogue against the gateway's published responses", () => {
  it("lists a destination from the offers its own country entry publishes", async () => {
    vi.stubGlobal("fetch", gateway(COUNTRIES_WITH_POOLS));
    const { readOtpOffersForSupplier } = await load();

    const read = await readOtpOffersForSupplier("bitcall", "us", "United States");

    expect(read.errorCode).toBeNull();
    expect(read.offers.map((offer) => offer.ref).sort()).toEqual(["BRAVO-US-telegram", "CHARLIE-US-openai_/_chatgpt"]);
    expect(read.offers.find((offer) => offer.ref === "BRAVO-US-telegram")).toMatchObject({
      supplier: "bitcall", country: "us", app: "Telegram", stock: 77, costNgn: Math.round(0.4 * EUR_NGN),
    });
  });

  it("lists a destination from the service catalogue when its country entry carries no offers", async () => {
    vi.stubGlobal("fetch", gateway(COUNTRIES_WITHOUT_POOLS));
    const { readOtpOffersForSupplier } = await load();

    const read = await readOtpOffersForSupplier("bitcall", "us", "United States");

    // Nothing on a service row says "United States". The offer's own id does.
    expect(read.errorCode).toBeNull();
    expect(read.offers).toHaveLength(1);
    expect(read.offers[0]).toMatchObject({
      ref: "CHARLIE-US-openai_/_chatgpt", country: "us", app: "OpenAI / ChatGPT", stock: 312,
      costNgn: Math.round(1.0025 * EUR_NGN),
    });
  });

  it("never files another destination's offer under the one being read", async () => {
    vi.stubGlobal("fetch", gateway(COUNTRIES_WITHOUT_POOLS));
    const { readOtpOffersForSupplier } = await load();

    const us = await readOtpOffersForSupplier("bitcall", "us", "United States");
    const nigeria = await readOtpOffersForSupplier("bitcall", "ng", "Nigeria");

    // Colombia's and Kyrgyzstan's Instagram numbers are not American ones, and a
    // service called "US Mobile" whose only number is Canadian is not either.
    for (const offer of us.offers) expect(offer.ref).toMatch(/^[A-Z]+-US-/);
    expect(us.offers.map((offer) => offer.ref)).not.toContain("DELTA-CA-us_mobile");
    expect(nigeria.offers.map((offer) => offer.ref)).toEqual(["DELTA-NG-adidas"]);
  });

  it("reports a destination the gateway does not publish as empty, not as an error", async () => {
    vi.stubGlobal("fetch", gateway(COUNTRIES_WITHOUT_POOLS));
    const { readOtpOffersForSupplier } = await load();

    const read = await readOtpOffersForSupplier("bitcall", "gh", "Ghana");

    expect(read).toMatchObject({ offers: [], errorCode: null });
  });

  it("answers every destination from one read of each feed", async () => {
    const fetchMock = gateway(COUNTRIES_WITHOUT_POOLS);
    vi.stubGlobal("fetch", fetchMock);
    const { readOtpOffersForSupplier } = await load();

    await readOtpOffersForSupplier("bitcall", "us", "United States");
    await readOtpOffersForSupplier("bitcall", "ng", "Nigeria");
    await readOtpOffersForSupplier("bitcall", "gb", "United Kingdom");

    // The feeds are the same for every destination. Walking them once per
    // country is what makes the storefront slow, not the gateway.
    expect(requestsTo(fetchMock, "/v1/otp/countries")).toHaveLength(1);
    expect(requestsTo(fetchMock, "/v1/otp/services")).toHaveLength(1);
  });

  it("asks the service catalogue for no country, because that feed cannot be trusted to honour one", async () => {
    const fetchMock = gateway(COUNTRIES_WITHOUT_POOLS);
    vi.stubGlobal("fetch", fetchMock);
    const { readOtpOffersForSupplier } = await load();

    await readOtpOffersForSupplier("bitcall", "us", "United States");

    for (const [input] of requestsTo(fetchMock, "/v1/otp/services")) {
      const params = new URL(String(input)).searchParams;
      expect(params.has("countryCode")).toBe(false);
      expect(params.has("country_code")).toBe(false);
    }
  });

  it("turns what it read into cards for the service hub", async () => {
    vi.stubGlobal("fetch", gateway(COUNTRIES_WITH_POOLS));
    const { readOtpOffersForSupplier, bitcallOtpItemsForCountry } = await load();

    const read = await readOtpOffersForSupplier("bitcall", "us", "United States");
    const items = bitcallOtpItemsForCountry(read.offers, "us", "United States");

    expect(items.map((item) => item.name).sort()).toEqual(["Openai / Chatgpt", "Telegram"]);
    for (const item of items) {
      expect(item).toMatchObject({ category: "verification", source: "live", coverage: "catalog-country" });
      // The supplier's reference stays on the server: a card carries an opaque id.
      expect(item.id).toMatch(/^otp-[0-9a-f]{24}$/);
      expect(JSON.stringify(item)).not.toContain("CHARLIE-US");
    }
  });
});

describe("the service hub's catalogue request, end to end", () => {
  /**
   * Everything between the request and the network is the real code: the route,
   * the catalogue reader, the gateway client. Only the session and the network
   * are stood in for. A signed-in customer asking for a country's app
   * verification listings is the request that came back empty.
   */
  async function ask(query: string) {
    // The test database is the in-memory one, which closes live listings. This is
    // the switch a local environment uses to open them without a real database.
    vi.stubEnv("FORCE_LIVE_LISTINGS", "1");
    vi.stubEnv("FLEEXA_API_KEY", "");
    vi.stubEnv("SMM_PANEL_API_KEY", "");
    vi.stubEnv("SMM_PANEL_API_URL", "");
    vi.doMock("@/lib/identity/auth", () => ({ getCurrentUser: async () => ({ id: `buyer-${query}` }) }));
    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/services/catalog/route");
    const { clearOtpCatalogueCache } = await import("@/lib/services/numbers/otp-suppliers");
    clearOtpCatalogueCache();
    const response = await GET(new NextRequest(`https://pryva.test/api/services/catalog?${query}`));
    return { status: response.status, body: await response.json() };
  }

  afterEach(() => { vi.doUnmock("@/lib/identity/auth"); });

  it("answers with the destination's listings", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", gateway(COUNTRIES_WITH_POOLS));

    const { status, body } = await ask("country=us&feed=verification");

    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, country: "us", live: true, partial: false, reason: null });
    expect(body.items.map((item: { name: string }) => item.name).sort()).toEqual(["Openai / Chatgpt", "Telegram"]);
    for (const item of body.items) expect(item).toMatchObject({ category: "verification", source: "live", stock: expect.any(Number) });

    // An offer that leaves a margin under the country's fixed price can be ordered
    // from its card, at that price.
    const telegram = body.items.find((item: { name: string }) => item.name === "Telegram");
    expect(telegram.price).toBe(1670);
    expect(telegram.action.href).toMatch(/^\/dashboard\/services\/otp\/otp-[0-9a-f]{24}\?country=us$/);

    // One that costs more than it would sell for is still listed, with its stock,
    // but cannot be ordered. Listed and orderable are different questions.
    const chatgpt = body.items.find((item: { name: string }) => item.name === "Openai / Chatgpt");
    expect(chatgpt).toMatchObject({ stock: 312, price: null, action: null });
    // Wholesale references, costs and the credential never reach the browser.
    const serialized = JSON.stringify(body);
    for (const secret of ["CHARLIE-US", "BRAVO-US", "costNgn", SECRET, KEY_ID]) expect(serialized).not.toContain(secret);
  });

  it("answers the same way when the country entry publishes no offers of its own", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", gateway(COUNTRIES_WITHOUT_POOLS));

    const { status, body } = await ask("country=us&feed=verification");

    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, live: true, partial: false });
    expect(body.items.map((item: { name: string }) => item.name)).toEqual(["OpenAI / ChatGPT"]);
  });
});
