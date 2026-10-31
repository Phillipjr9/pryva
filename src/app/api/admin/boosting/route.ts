import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminApi } from "@/lib/admin-auth";
import { logger } from "@/lib/logger";
import {
  getSmmBalance,
  isSmmPanelConfigured,
  listSmmServices,
  panelEndpoint,
  SmmPanelError,
} from "@/lib/smm-panel";
import { selectBoostServices } from "@/lib/smm-catalog";
import { normalizeCurrency, smmMarkupPercent, smmUsdNgnRate } from "@/lib/smm-pricing";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/boosting
 *
 * "Is boosting actually working right now?" — answered by asking the supplier
 * three read-only questions: does it answer at all, what does it bill in, and
 * what would each of its services cost a customer after our margin.
 *
 * Read-only by construction: `balance` and `services` are GETs on the supplier's
 * API. This endpoint cannot place, refill or cancel an order, and it never
 * returns the key or a wholesale rate.
 *
 * Admin-only. The counts and the currency are operational facts; the supplier's
 * identity is not something to expose anywhere a customer could reach.
 */
export async function GET(request: NextRequest) {
  const access = await authorizeAdminApi(request);
  if (access.response) return access.response;

  const configured = isSmmPanelConfigured();
  const markupPercent = smmMarkupPercent();
  const fxRate = smmUsdNgnRate();

  let endpointHost: string | null = null;
  let endpointProblem: string | null = null;
  try {
    endpointHost = new URL(panelEndpoint()).host;
  } catch (error) {
    endpointProblem =
      error instanceof SmmPanelError
        ? "The configured endpoint is not a usable https address (no credentials, no internal host)."
        : "The configured endpoint is not a valid URL.";
  }

  if (!configured) {
    return NextResponse.json(
      {
        ok: true,
        configured: false,
        endpointHost,
        endpointProblem,
        markupPercent,
        fxRate,
        reachable: false,
        currency: null,
        balance: null,
        services: 0,
        listed: 0,
        error: null,
        hint: "Set SMM_PANEL_API_KEY and SMM_PANEL_API_URL, then run this check again.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  let balance: { balance: number | null; currency: string | null } | null = null;
  let services: Awaited<ReturnType<typeof listSmmServices>> = [];
  let error: string | null = null;

  try {
    balance = await getSmmBalance();
  } catch (caught) {
    error = describeFailure(caught, "The supplier refused the balance check");
    logger.warn("Admin boosting check: balance failed", { error: caught });
  }

  try {
    services = await listSmmServices();
  } catch (caught) {
    error = error ?? describeFailure(caught, "The supplier refused the catalogue read");
    logger.warn("Admin boosting check: catalogue failed", { error: caught });
  }

  const currency = normalizeCurrency(balance?.currency ?? services[0]?.currency ?? null);
  // What the shop would actually show, which is the number that matters: a large
  // panel returns thousands of services and Pryva lists a handful, one per
  // platform and intent, every one of them priced.
  const selection = selectBoostServices(services, balance?.currency ?? null);

  const hint = (() => {
    if (error) return "Boosting is on, but the supplier did not answer. Check the key, the endpoint and the balance.";
    if (services.length === 0) return "The supplier answered but returned no services, so there is nothing to sell yet.";
    // An unpriced catalogue is usually one missing number, not a broken panel, so
    // say which one before saying nothing is listed.
    if (currency === "USD" && fxRate === null) {
      return "The supplier bills in USD and SMM_USD_NGN_RATE is not set, so no price can be computed. Nothing is listed rather than sold at a guessed exchange rate.";
    }
    if (selection.listed === 0) {
      return "The supplier answered, but none of its services is a social boost Pryva lists. Check that this is the catalogue you expect.";
    }
    return `${selection.listed} of ${services.length} supplier services are listed for sale — one per platform and intent, each priced and ready. Place one small test order before announcing the service.`;
  })();

  return NextResponse.json(
    {
      ok: true,
      configured: true,
      endpointHost,
      endpointProblem,
      markupPercent,
      fxRate,
      reachable: error === null,
      currency,
      balance: balance?.balance ?? null,
      services: services.length,
      listed: selection.listed,
      error,
      hint,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * Supplier errors carry the panel's own words, which are useful to an operator
 * and short enough to show. Anything else is unexpected and is reduced to a
 * sentence so a stack trace cannot leak through the admin screen.
 */
function describeFailure(caught: unknown, fallback: string): string {
  if (caught instanceof SmmPanelError) return `${fallback}: ${caught.message}`;
  return `${fallback}.`;
}
