import { redirect } from "next/navigation";
import { googleAuthorizeUrl, googleConfigured, makeState } from "@/lib/identity/google";
import { signState } from "@/lib/identity/google-state";
import { safeRedirectPath } from "@/lib/platform/safe-redirect";
import { publicOrigin, requestProto } from "@/lib/platform/net";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "pryva_google_state";
const NEXT_COOKIE = "pryva_google_next";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeRedirectPath(url.searchParams.get("next"));

  if (!googleConfigured()) {
    redirect("/login?error=google-not-configured");
  }

  // Store the browser-binding cookie on exactly the callback host. In particular,
  // a user starting on www or a deployment URL must reach the canonical domain
  // before Google is opened, or a host-only cookie will be missing on return.
  const origin = publicOrigin(request);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const incomingOrigin = new URL(`${requestProto(request)}://${host}`).origin;
  if (incomingOrigin !== origin) {
    const canonicalStart = new URL("/api/auth/google", origin);
    canonicalStart.searchParams.set("next", next);
    return Response.redirect(canonicalStart, 302);
  }

  const nonce = makeState();
  const state = signState(nonce) ?? nonce;
  const authorizeUrl = googleAuthorizeUrl(request, state);
  const secure = new URL(origin).protocol === "https:";

  const response = new Response(null, { status: 302, headers: { Location: authorizeUrl } });
  const cookieBase = `Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure ? "; Secure" : ""}`;

  response.headers.append("Set-Cookie", `${STATE_COOKIE}=${state}; ${cookieBase}`);
  response.headers.append("Set-Cookie", `${NEXT_COOKIE}=${encodeURIComponent(next)}; ${cookieBase}`);

  return response;
}
