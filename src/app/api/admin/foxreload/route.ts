import { authorizeAdminApi } from "@/lib/identity/admin-auth";
import { createRateLimiter } from "@/lib/platform/rate-limit";
import { financialActionsUnavailable } from "@/lib/platform/financial-environment";
import { FoxreloadError, isFoxreloadConfigured, probeFoxreloadAccount } from "@/lib/providers/foxreload";
import { approvedCodeOffers } from "@/lib/services/foxreload/code-offers";
import { approvedEsimOffers } from "@/lib/services/foxreload/esim-offers";
import { approvedTopupOffers } from "@/lib/services/foxreload/topup-offers";
import { foxreloadRate } from "@/lib/services/foxreload/exchange-rate";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const limit = createRateLimiter({ windowMs: 60_000, maxRequests: 5 });
const reply = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

/** Read-only, admin-only check. No profile, secrets, supplier errors or amounts leave the server. */
export async function GET(request: Request) {
  const access = await authorizeAdminApi(request);
  if (access.response) return access.response;
  const allowed = await limit(`admin:foxreload-check:${access.user.id}`);
  if (allowed.unavailable) return reply({ ok: false, error: "Check temporarily unavailable." }, 503);
  if (!allowed.allowed) return reply({ ok: false, error: "Try again in a minute." }, 429);
  const configured = isFoxreloadConfigured();
  const rate = await foxreloadRate();
  const secret = process.env.FOXRELOAD_INTENT_SECRET;
  const offers = approvedTopupOffers();
  const settings = {
    purchasesBlockedInEnvironment: financialActionsUnavailable(),
    mock: process.env.FOXRELOAD_IS_MOCK === "true",
    rateConfigured: rate !== null,
    rateSource: rate?.source ?? "unavailable",
    intentSecretConfigured: !!secret && secret.length >= 32 && secret.length <= 1024,
    starsEnabled: process.env.FOXRELOAD_STARS_ENABLED === "true",
    codesEnabled: process.env.FOXRELOAD_CODES_ENABLED === "true",
    topupsEnabled: process.env.FOXRELOAD_TOPUPS_ENABLED === "true",
    loginTopupsEnabled: process.env.FOXRELOAD_LOGIN_TOPUPS_ENABLED === "true",
    confirmationsEnabled: process.env.FOXRELOAD_CLIENT_CODES_ENABLED === "true",
    esimsEnabled: process.env.FOXRELOAD_ESIMS_ENABLED === "true",
    reviewedCodes: approvedCodeOffers().length,
    reviewedDirectTopups: offers.filter((offer) => (offer.deliveryType ?? "direct_topup") === "direct_topup").length,
    reviewedLoginTopups: offers.filter((offer) => offer.deliveryType === "login_topup").length,
    reviewedEsims: approvedEsimOffers().length,
  };
  if (!configured) return reply({ ok: true, configured: false, account: null, error: null, settings });
  try {
    const account = await probeFoxreloadAccount();
    return reply({ ok: true, configured: true, account, error: null, settings });
  } catch (error) {
    // Never serialize provider messages, response bodies, credentials or account data.
    const failure = error instanceof FoxreloadError && (error.status === 401 || error.status === 403) ? "auth" : "unavailable";
    return reply({ ok: true, configured: true, account: null, error: failure, settings });
  }
}
