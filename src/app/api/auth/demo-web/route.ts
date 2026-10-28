import { createSession } from "@/lib/auth";
import { openDemoAccount } from "@/lib/demo";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { isArenaPreviewHost, isSameOriginMutation, relativeRedirect } from "@/lib/net";
import { previewDemoBridgePage } from "@/lib/preview-demo-bridge";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { readTextWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { clientIp } from "@/lib/auth-rate-limit";
import { demoRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

function formError(message: string, status: number): Response {
  // This endpoint is a browser navigation, not a JSON API. Give visitors a
  // visible recovery link if the form cannot be accepted. Messages are fixed.
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign-in unavailable</title></head><body style="font-family:system-ui,sans-serif;background:#faf7f1;color:#252025;margin:0;padding:2rem"><main style="max-width:32rem;margin:3rem auto"><h1>Sign-in unavailable</h1><p>${message}</p><p><a href="/login">Return to sign in</a></p></main></body></html>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" },
  });
}

async function openDemo(rawNext: unknown, request: Request) {
  const nextPath = safeRedirectPath(rawNext);

  if (!isPreviewDatabase()) {
    return relativeRedirect("/login?error=demo-failed", 303);
  }

  const limit = await demoRateLimiter(`demo:ip:${clientIp(request)}`);
  if (!limit.allowed) return relativeRedirect("/login?error=demo-failed", 303);

  try {
    const user = await openDemoAccount();
    if (!user) return relativeRedirect("/login?error=demo-failed", 303);

    const token = await createSession(user.id, request);
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
    if (isArenaPreviewHost(host)) return previewDemoBridgePage(nextPath, token);
    return relativeRedirect(nextPath, 303);
  } catch (error) {
    console.error("Demo login failed:", error);
    return relativeRedirect("/login?error=demo-failed", 303);
  }
}

/**
 * HTML-form demo login.
 *
 * A plain `method="post"` submit lands here. Ordinary hosts receive a 303;
 * the isolated Arena preview receives a bridge page for its public demo when
 * the gateway drops cookies. The client never intercepts the form submission.
 */
export async function POST(request: Request) {
  if (!isPreviewDatabase()) return relativeRedirect("/login?error=demo-failed", 303);
  if (!isSameOriginMutation(request)) return formError("We could not verify this sign-in request. Refresh the sign-in page and try again.", 403);
  if (!/^application\/x-www-form-urlencoded(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return formError("Please return to the sign-in page and try again.", 415);
  }
  try {
    const form = new URLSearchParams(await readTextWithLimit(request, 2_048));
    return openDemo(form.get("next"), request);
  } catch (error) {
    return formError("The sign-in request could not be read. Please return and try again.", error instanceof RequestBodyTooLargeError ? 413 : 400);
  }
}

/**
 * Same flow as GET, for the "button not responding" fallback link rendered
 * under the demo button. Demo sessions are preview-only, so there is nothing
 * here a stranger could use to reach someone else's account.
 */
export async function GET(request: Request) {
  return openDemo(new URL(request.url).searchParams.get("next"), request);
}
