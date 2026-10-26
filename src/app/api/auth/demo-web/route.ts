import { createSession } from "@/lib/auth";
import { openDemoAccount } from "@/lib/demo";
import { relativeRedirect } from "@/lib/net";

export const dynamic = "force-dynamic";

/**
 * Direct demo sign-in for link navigation. It uses a static, read-only account
 * so the flow remains available even when a database is not configured.
 */
async function signIntoDemo(request: Request) {
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

export async function GET(request: Request) {
  // Avoid login-CSRF from third-party pages. Same-origin clicks and direct
  // address-bar navigation remain available in browsers that send this header.
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return relativeRedirect("/login?error=demo-failed", 303);
  }
  return signIntoDemo(request);
}

/** Retain the form-post endpoint for non-link clients. */
export async function POST(request: Request) {
  return signIntoDemo(request);
}
