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

export class ClubkonnectError extends Error {
  constructor() {
    super("Mobile data supplier is temporarily unavailable.");
    this.name = "ClubkonnectError";
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

export function parseClubkonnectPlans(payload: unknown): ClubkonnectPlan[] {
  const networks = row(row(payload).MOBILE_NETWORK);
  if (!Object.keys(networks).length) throw new ClubkonnectError();
  const plans: ClubkonnectPlan[] = [];
  const seen = new Set<string>();
  for (const [network, groups] of Object.entries(networks)) {
    if (!Array.isArray(groups)) throw new ClubkonnectError();
    for (const group of groups) {
      const entry = row(group);
      const networkCode = typeof entry.ID === "string" ? entry.ID : "";
      if (!/^\d+$/.test(networkCode) || !Array.isArray(entry.PRODUCT)) throw new ClubkonnectError();
      for (const item of entry.PRODUCT) {
        const product = row(item);
        const productCode = typeof product.PRODUCT_CODE === "string" ? product.PRODUCT_CODE : "";
        const name = typeof product.PRODUCT_NAME === "string" ? product.PRODUCT_NAME.trim() : "";
        const amount = String(product.PRODUCT_AMOUNT ?? "");
        if (!/^\d+$/.test(productCode) || !name || !/^\d+(?:\.\d{1,2})?$/.test(amount)) throw new ClubkonnectError();
        const [whole, fraction = ""] = amount.split(".");
        const publishedAmountKobo = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
        const id = `clubkonnect:${networkCode}:${productCode}`;
        if (!Number.isSafeInteger(publishedAmountKobo) || publishedAmountKobo <= 0 || seen.has(id)) throw new ClubkonnectError();
        seen.add(id);
        plans.push({ id, network, networkCode, productCode, name, publishedAmountKobo,
          dataType: typeof product.DATA_TYPE === "string" ? product.DATA_TYPE : null, stock: null });
      }
    }
  }
  return plans.sort((a, b) => a.publishedAmountKobo - b.publishedAmountKobo || a.id.localeCompare(b.id));
}

async function read(endpoint: string, parameters: Record<string, string>, authenticated: boolean): Promise<unknown> {
  const userId = process.env.CLUBKONNECT_USER_ID?.trim();
  const apiKey = process.env.CLUBKONNECT_API_KEY?.trim();
  if (!userId || (authenticated && !apiKey)) throw new ClubkonnectError();
  const url = new URL(endpoint, HOST);
  url.searchParams.set("UserID", userId);
  if (authenticated) url.searchParams.set("APIKey", apiKey!);
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  try {
    const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new ClubkonnectError();
    return await readJsonWithLimit(response, 2 * 1024 * 1024);
  } catch {
    // Never propagate fetch errors: URLs contain supplier credentials.
    throw new ClubkonnectError();
  }
}

export async function listClubkonnectPlans(): Promise<ClubkonnectPlan[]> {
  return parseClubkonnectPlans(await read("/APIDatabundlePlansV3.asp", {}, false));
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
