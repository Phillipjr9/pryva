import "server-only";
import { readJsonWithLimit } from "@/lib/platform/request-body";

// Official API host documented at clubkonnect.com/APIParaGetDataBundleV1.
// Credentials must never be sent to the browser or included in logged errors.
const HOST = "https://www.nellobytesystems.com";
export const CLUBKONNECT_USER_ID_ENV = "CLUBKONNECT_USER_ID";
export const CLUBKONNECT_API_KEY_ENV = "CLUBKONNECT_API_KEY";

export function isClubkonnectConfigured(): boolean {
  return Boolean(process.env.CLUBKONNECT_USER_ID?.trim() && process.env.CLUBKONNECT_API_KEY?.trim());
}

/**
 * Reading the published catalogue is not a purchase.
 *
 * `APIDatabundlePlansV3.asp` is called with `UserID` alone — the API key is not
 * part of that request (see `read(..., authenticated: false)`), so demanding one
 * here only ever reproduced the "catalogue is not connected yet" page on a
 * deployment whose buyer credential had been blanked or rotated. The catalogue
 * needs the account identifier and nothing else.
 */
export function isClubkonnectCatalogueConfigured(): boolean {
  return Boolean(process.env.CLUBKONNECT_USER_ID?.trim());
}

export class ClubkonnectError extends Error {
  constructor() {
    super("Mobile data supplier is temporarily unavailable.");
    this.name = "ClubkonnectError";
  }
}

/**
 * The account was answered, and answered with a refusal.
 *
 * The host replies `{"status":"INVALID_CREDENTIALS"}` (or `MISSING_PHONE_NUMBER`)
 * with HTTP 200 when the identifier is not an account it will serve. That is not
 * an outage: retrying costs the same refusal every minute, which is exactly how a
 * page ended up saying "please retry" forever. It is reported separately so the
 * route can state the truth and the diagnostics feed can name the cause.
 *
 * `code` is restricted to a short upper-case token from the payload: it is the
 * host's own status word, never a URL, an amount or a credential.
 */
export class ClubkonnectAccountError extends ClubkonnectError {
  readonly code: string;
  constructor(code: string) {
    super();
    this.name = "ClubkonnectAccountError";
    this.code = code;
  }
}

type Row = Record<string, unknown>;
function row(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

export type ClubkonnectPlan = {
  id: string;
  network: string;
  networkCode: string;
  productCode: string;
  name: string;
  // Preserve the published amount, not an assumed account-specific discount.
  publishedAmountKobo: number;
  dataType: string | null;
  // The catalogue does not report a numeric stock count.
  stock: null;
};

export type ClubkonnectCatalogue = {
  plans: ClubkonnectPlan[];
  /** Products the host published that could not be read. Never hidden from the page. */
  skipped: number;
  /** Networks the host published with no readable product at all. */
  emptyNetworks: string[];
};

/**
 * Published network labels are not display names.
 *
 * The catalogue groups products under keys like `MTN`, `Glo`, `Airtel` and
 * `m_9mobile`; rendering the key verbatim printed "m_9mobile" on the cards and in
 * the network filter. Codes are what a purchase needs, so the label comes from
 * the code with the key only as a fallback.
 */
const NETWORK_NAMES: Record<string, string> = { "01": "MTN", "02": "Glo", "03": "9mobile", "04": "Airtel" };

function networkName(key: string, code: string): string {
  const known = NETWORK_NAMES[code];
  if (known) return known;
  const cleaned = key.replace(/^m_/i, "").replace(/[_-]+/g, " ").trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : key;
}

/** Fixed, non-credential status words the host returns instead of a catalogue. */
const REFUSAL_CODES = new Set(["INVALID_CREDENTIALS", "MISSING_PHONE_NUMBER", "MISSING_USERID", "INVALID_USERID"]);

/**
 * Read one published catalogue.
 *
 * A single unreadable product used to throw, so one bad row — a blank amount, a
 * renamed field, a duplicate code — emptied the whole page and the customer was
 * told the service was down while every other bundle was fine. Rows are now read
 * individually: good ones are kept, bad ones are counted, and the count is
 * published so the page can say "some bundles could not be shown" instead of
 * pretending the catalogue is complete.
 *
 * The envelope is still validated. A payload that is not a catalogue at all, or
 * that names no readable product anywhere, must not render as "0 bundles
 * available" — that is indistinguishable from a real outage of published stock.
 */
export function parseClubkonnectCatalogue(payload: unknown): ClubkonnectCatalogue {
  const body = row(payload);
  const refusal = typeof body.status === "string" ? body.status.trim().toUpperCase() : "";
  if (refusal && !body.MOBILE_NETWORK && /^[A-Z_]{3,40}$/.test(refusal)) throw new ClubkonnectAccountError(refusal);

  const networks = row(body.MOBILE_NETWORK);
  if (!Object.keys(networks).length) throw new ClubkonnectError();

  const plans: ClubkonnectPlan[] = [];
  const seen = new Set<string>();
  const emptyNetworks: string[] = [];
  let skipped = 0;

  for (const [network, groups] of Object.entries(networks)) {
    // A malformed network entry is one network's problem, not the catalogue's.
    const entries = Array.isArray(groups) ? groups : [];
    let readableHere = 0;
    for (const group of entries) {
      const entry = row(group);
      const networkCode = typeof entry.ID === "string" ? entry.ID.trim() : "";
      // Networks are also published under prefixed keys (`m_9mobile`), so the
      // label is not a network code; only `ID` is trusted for ordering.
      if (!/^\d+$/.test(networkCode) || !Array.isArray(entry.PRODUCT)) continue;
      for (const item of entry.PRODUCT) {
        const product = row(item);
        const productCode = typeof product.PRODUCT_CODE === "string" ? product.PRODUCT_CODE.trim() : "";
        const name = typeof product.PRODUCT_NAME === "string" ? product.PRODUCT_NAME.trim() : "";
        const amount = String(product.PRODUCT_AMOUNT ?? "").trim();
        const id = `clubkonnect:${networkCode}:${productCode}`;
        const [whole, fraction = ""] = amount.split(".");
        const publishedAmountKobo = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
        if (!/^\d+$/.test(productCode) || !name || !/^\d+(?:\.\d{1,2})?$/.test(amount) ||
            !Number.isSafeInteger(publishedAmountKobo) || publishedAmountKobo <= 0 || seen.has(id)) {
          skipped += 1;
          continue;
        }
        seen.add(id);
        readableHere += 1;
        plans.push({ id, network: networkName(network, networkCode), networkCode, productCode, name, publishedAmountKobo,
          dataType: typeof product.DATA_TYPE === "string" ? product.DATA_TYPE : null, stock: null });
      }
    }
    if (!readableHere && !emptyNetworks.includes(network)) emptyNetworks.push(network);
  }

  if (!plans.length) throw new ClubkonnectError();
  return { plans: plans.sort((a, b) => a.publishedAmountKobo - b.publishedAmountKobo || a.id.localeCompare(b.id)), skipped, emptyNetworks };
}

/** The plans alone, for callers that do not report how complete the read was. */
export function parseClubkonnectPlans(payload: unknown): ClubkonnectPlan[] {
  return parseClubkonnectCatalogue(payload).plans;
}

async function read(
  endpoint: string,
  parameters: Record<string, string>,
  authenticated: boolean,
  attempts = 1,
): Promise<unknown> {
  const userId = process.env.CLUBKONNECT_USER_ID?.trim();
  const apiKey = process.env.CLUBKONNECT_API_KEY?.trim();
  if (!userId || (authenticated && !apiKey)) throw new ClubkonnectError();
  const url = new URL(endpoint, HOST);
  url.searchParams.set("UserID", userId);
  if (authenticated) url.searchParams.set("APIKey", apiKey!);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new ClubkonnectError();
      return await readJsonWithLimit(response, 2 * 1024 * 1024);
    } catch (error) {
      /*
       * Never propagate fetch errors: URLs contain supplier credentials.
       *
       * A refusal is final — the same identifier earns the same answer — so only
       * transport and parse failures are retried, and only once. Without the
       * retry, one slow response at cold start left the page empty until a
       * customer happened to load it again after the read succeeded for somebody
       * else.
       */
      if (error instanceof ClubkonnectAccountError || attempt >= attempts) throw new ClubkonnectError();
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
}

/**
 * Read the whole published catalogue, including how much of it was readable.
 *
 * Callers report `skipped` and `emptyNetworks`, because a page that silently
 * drops four unreadable bundles is a page that lies about what is for sale.
 */
export async function listClubkonnectCatalogue(): Promise<ClubkonnectCatalogue> {
  // The read is shared by every shopper, so it is worth two attempts; a refusal
  // is not retried inside `read`.
  return parseClubkonnectCatalogue(await read("/APIDatabundlePlansV3.asp", {}, false, 2));
}

export async function listClubkonnectPlans(): Promise<ClubkonnectPlan[]> {
  return (await listClubkonnectCatalogue()).plans;
}

// Explicit read-only allowlist. Never accept a caller-supplied endpoint: this
// provider also exposes money-moving GET endpoints on the same host.
const CATALOGUE_ENDPOINTS = {
  airtime: "/APIAirtimeNetworkV2.asp",
  data: "/APIDatabundlePlansV3.asp",
  cable: "/APICableTVPackagesV2.asp",
  electricity: "/APIElectricityDiscosV1.asp",
  "recharge-pins": "/APIEPINDiscountV2.asp",
  smile: "/APISmilePackagesV2.asp",
  waec: "/APIWAECPackagesV2.asp",
  jamb: "/APIJAMBPackagesV2.asp",
} as const;

export type ClubkonnectCatalogueService = keyof typeof CATALOGUE_ENDPOINTS;

/** Server-only raw contracts; normalize and validate before customer exposure. */
export async function readClubkonnectCatalogue(service: ClubkonnectCatalogueService): Promise<unknown> {
  if (!Object.prototype.hasOwnProperty.call(CATALOGUE_ENDPOINTS, service)) throw new ClubkonnectError();
  return read(CATALOGUE_ENDPOINTS[service], {}, false);
}

export type ClubkonnectOutcome = "delivered" | "cancelled" | "pending";
export function clubkonnectOutcome(payload: unknown): ClubkonnectOutcome {
  const value = row(payload);
  const code = String(value.statuscode ?? value.statusCode ?? "");
  const status = String(value.orderstatus ?? value.status ?? "").toUpperCase();
  // 201 and 299 can say ORDER_COMPLETED without confirming actual delivery.
  if (code === "200" && status === "ORDER_COMPLETED") return "delivered";
  // 521 is ambiguous: already completed/cancelled/refunded. Reconcile manually.
  if (/^5\d\d$/.test(code) && code !== "521" && status === "ORDER_CANCELLED") return "cancelled";
  return "pending";
}

export async function queryClubkonnectRequest(requestId: string): Promise<unknown> {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(requestId)) throw new ClubkonnectError();
  return read("/APIQueryV1.asp", { RequestID: requestId }, true);
}
