import { createSession } from "@/lib/auth";
import { openDemoAccount } from "@/lib/demo";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { relativeRedirect } from "@/lib/net";

export const dynamic = "force-dynamic";

function safeNext(raw: unknown): string {
  return typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//")
    ? raw
    : "/dashboard";
}

async function openDemo(rawNext: unknown, request: Request) {
  const nextPath = safeNext(rawNext);

  if (!isPreviewDatabase()) {
    return relativeRedirect("/login?error=demo-failed", 303);
  }

  try {
    const user = await openDemoAccount();
    if (!user) return relativeRedirect("/login?error=demo-failed", 303);

    await createSession(user.id, request);
    return relativeRedirect(nextPath, 303);
  } catch (error) {
    console.error("Demo login failed:", error);
    return relativeRedirect("/login?error=demo-failed", 303);
  }
}

/**
 * HTML-form demo login.
 *
 * A plain `method="post"` submit lands here and the 303 takes the visitor
 * straight into the dashboard — no client JavaScript in the path, so a stale
 * bundle, a blocked fetch or a hanging request can't leave the button spinning.
 * The client shows "Opening the demo…" but never intercepts the submit.
 */
export async function POST(request: Request) {
  let rawNext: unknown = "/dashboard";
  try {
    const formData = await request.formData();
    rawNext = formData.get("next");
  } catch {
    /* empty body — default to /dashboard */
  }
  return openDemo(rawNext, request);
}

/**
 * Same flow as GET, for the "button not responding" fallback link rendered
 * under the demo button. Demo sessions are preview-only, so there is nothing
 * here a stranger could use to reach someone else's account.
 */
export async function GET(request: Request) {
  return openDemo(new URL(request.url).searchParams.get("next"), request);
}
