import { createSession } from "@/lib/auth";
import { openDemoAccount } from "@/lib/demo";
import { relativeRedirect } from "@/lib/net";

export const dynamic = "force-dynamic";

/**
 * HTML-form demo login: a plain `method="post"` submit lands here and the
 * 303 redirect takes the visitor straight to the dashboard — works in every
 * browser, with or without JavaScript. Redirects are relative so they stay
 * on the origin the visitor is actually using.
 */
export async function POST(request: Request) {
  try {
    const user = await openDemoAccount();
    if (!user) return relativeRedirect("/login?error=demo-failed", 303);

    await createSession(user.id, request);
    return relativeRedirect("/dashboard", 303);
  } catch (error) {
    console.error("Demo web login failed:", error);
    return relativeRedirect("/login?error=demo-failed", 303);
  }
}
