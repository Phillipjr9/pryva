import "server-only";

import { verificationArtwork } from "@/lib/services/numbers/verification-marks";
import { ProviderError } from "@/lib/providers/types";
import { explorerCountry, VERIFICATION_EXAMPLES, type ExplorerItem } from "@/lib/services/service-explorer";
import { checkMargin } from "@/lib/services/margin-guard";
import { safeUnitCount } from "@/lib/services/service-units";
import { fulfilablePlans } from "@/lib/services/fulfillment";
import type { Plan } from "@/lib/services/catalog";
import {
  otpOfferPublicId,
  readOtpOffersForSupplier,
  type OtpOffer,
} from "@/lib/services/numbers/otp-suppliers";

function numberPlanForCountry(countryCode: string): Plan | null {
  const code = countryCode.trim().toLowerCase();
  return fulfilablePlans().find(({ intent }) => intent.kind === "sms" && intent.country === code)?.plan ?? null;
}

/** A provider app name, cleaned for display; null when it is missing or unusable. */
function readableLabel(app: string | null): string | null {
  const cleaned = app?.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned && cleaned.length <= 80 ? cleaned : null;
}

function appBrand(app: string) {
  return VERIFICATION_EXAMPLES.find((entry) => entry.name.toLowerCase() === app.trim().toLowerCase()) ?? null;
}

function canSell(plan: Plan, offer: OtpOffer): boolean {
  return offer.costNgn !== null && (offer.stock === null || offer.stock > 0) && checkMargin(plan.price, offer.costNgn).ok;
}

/**
 * Provider-published OTP offers shaped for the service hub. Wholesale service
 * references and costs stay on the server; the stable public ID is resolved
 * against a fresh catalogue again at checkout.
 */
export function bitcallOtpItemsForCountry(
  offers: OtpOffer[],
  countryCode: string,
  countryName: string,
): ExplorerItem[] {
  const country = explorerCountry(countryCode);
  if (!country) return [];
  // A number plan is required to sell an offer, not to report the stock Bitcall
  // publishes. Show inventory for every selected country; countries without an
  // explicit checkout plan remain view-only below.
  const plan = numberPlanForCountry(country.code);

  // An offer with no readable app is still stock Bitcall publishes. Dropping it
  // was the quietest possible way to lose a whole country's inventory: the read
  // succeeds, nothing errors, and the shelf simply has no numbers on it. It is
  // listed under a neutral label and remains purchasable — the checkout resolves
  // it by its opaque ref either way.
  const byApp = new Map<string, OtpOffer[]>();
  for (const offer of offers) {
    const named = offer.app?.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
    if (named && named.length > 80) continue;
    const key = named?.toLocaleLowerCase() ?? "";
    const group = byApp.get(key);
    if (group) group.push(offer);
    else byApp.set(key, [offer]);
  }

  const items: ExplorerItem[] = [];
  for (const group of byApp.values()) {
    const candidates = [...group].sort((a, b) => {
      const aSellable = plan !== null && canSell(plan, a) ? 0 : 1;
      const bSellable = plan !== null && canSell(plan, b) ? 0 : 1;
      return aSellable - bSellable ||
        (a.costNgn ?? Number.MAX_SAFE_INTEGER) - (b.costNgn ?? Number.MAX_SAFE_INTEGER);
    });
    const offer = candidates[0];
    if (!offer) continue;
    const label = readableLabel(offer.app) ?? "Verification number";
    const id = otpOfferPublicId(country.code, offer.ref, offer.app);
    const sellable = plan !== null && canSell(plan, offer);
    const brand = appBrand(label);
    items.push({
      id,
      category: "verification",
      name: label,
      description: plan
        ? "Live app-specific number offer"
        : "Bitcall stock listing · checkout is not enabled for this country",
      tag: brand?.tag ?? "Other",
      artwork: brand ? { kind: "brand", name: brand.brand } : verificationArtwork(label),
      source: "live",
      coverage: "catalog-country",
      stock: safeUnitCount(offer.stock),
      myUnits: null,
      price: sellable && plan ? plan.price : null,
      action: sellable
        ? { label: "Choose service", href: `/dashboard/services/otp/${encodeURIComponent(id)}?country=${country.code}` }
        : null,
      detail: `${countryName} · single-use verification`,
    });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

export type BitcallOtpCheckoutOffer = {
  id: string;
  app: string;
  countryCode: string;
  countryName: string;
  plan: Plan;
  priceNgn: number;
  purchasable: boolean;
};

/** Resolve the opaque listing ID back to a current provider-published offer. */
export async function findOtpCheckoutOffer(
  countryCode: string,
  offerId: string,
  options: { refresh?: boolean } = {},
): Promise<{ listing: BitcallOtpCheckoutOffer | null; errorCode: string | null }> {
  const country = explorerCountry(countryCode);
  if (!country) return { listing: null, errorCode: "INVALID_COUNTRY" };
  const plan = numberPlanForCountry(country.code);
  if (!plan) return { listing: null, errorCode: "UNSUPPORTED_COUNTRY" };

  const read = await readOtpOffersForSupplier("bitcall", country.code, country.name, options.refresh);
  if (read.errorCode) return { listing: null, errorCode: read.errorCode };
  // The app is not required to resolve an offer: the id is the ref plus whatever
  // label the provider gave it, which may be none.
  const offer = read.offers.find((entry) => otpOfferPublicId(country.code, entry.ref, entry.app) === offerId);
  if (!offer) return { listing: null, errorCode: null };
  const sellable = canSell(plan, offer);
  return {
    listing: {
      id: offerId,
      app: readableLabel(offer.app) ?? "Verification number",
      countryCode: country.code,
      countryName: country.name,
      plan,
      priceNgn: plan.price,
      purchasable: sellable,
    },
    errorCode: null,
  };
}

/** Keep provider read failures safe to render, while preserving funding vs outage. */
export function otpCatalogProviderError(code: string): ProviderError {
  return new ProviderError("OTP catalog could not be confirmed", {
    provider: "bitcall",
    status: code === "INSUFFICIENT_BALANCE" ? 402 : 502,
    code,
  });
}
