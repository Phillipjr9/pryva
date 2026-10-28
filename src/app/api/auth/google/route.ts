import { redirect } from "next/navigation";
import { googleAuthorizeUrl, googleConfigured, makeState } from "@/lib/google";
import { safeRedirectPath } from "@/lib/safe-redirect";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "pryva_google_state";
const NEXT_COOKIE = "pryva_google_next";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeRedirectPath(url.searchParams.get("next"));

  if (!googleConfigured()) {
    redirect("/login?error=google-not-configured");
  }

  const state = makeState();
  const authorizeUrl = googleAuthorizeUrl(request, state);

  const proto = request.headers.get("x-forwarded-proto");
  const secure = proto ? proto.startsWith("https") : process.env.NODE_ENV === "production";

  const response = new Response(null, { status: 302, headers: { Location: authorizeUrl } });
  const cookieBase = `Path=/; HttpOnly; SameSite=Lax; Max-Age=600${secure ? "; Secure" : ""}`;

  response.headers.append("Set-Cookie", `${STATE_COOKIE}=${state}; ${cookieBase}`);
  response.headers.append("Set-Cookie", `${NEXT_COOKIE}=${encodeURIComponent(next)}; ${cookieBase}`);

  return response;
}
