import { createSession } from "@/lib/auth";
import { openDemoAccount } from "@/lib/demo";
import { relativeRedirect } from "@/lib/net";

export const dynamic = "force-dynamic";

/**
 * HTML-form demo login: a plain `method="post"` submit lands here and the
 * 303 redirect takes the visitor straight to the dashboard (or requested
 * `next` path) — works with or without JavaScript.
 */
export async function POST(request: Request) {
  try {
    let nextPath = "/dashboard";
    try {
      const formData = await request.formData();
      const rawNext = formData.get("next");
      if (typeof rawNext === "string" && rawNext.startsWith("/") && !rawNext.startsWith("//")) {
        nextPath = rawNext;
      }
    } catch {
      /* empty body — default to /dashboard */
    }

    const user = await openDemoAccount();
    if (!user) return relativeRedirect("/login?error=demo-failed", 303);

    await createSession(user.id, request);
    return relativeRedirect(nextPath, 303);
  } catch (error) {
    console.error("Demo web login failed:", error);
    return relativeRedirect("/login?error=demo-failed", 303);
  }
}
