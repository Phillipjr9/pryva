import { createSession } from "@/lib/auth";
import { openDemoAccount } from "@/lib/demo";
import { isPreviewDatabase } from "@/lib/demo-policy";

export const dynamic = "force-dynamic";

/** JSON demo login (used by fetch-based clients). */
export async function POST(request: Request) {
  if (!isPreviewDatabase()) {
    return Response.json({ ok: false, error: "Demo login is available only in preview mode." }, { status: 403 });
  }
  try {
    const user = await openDemoAccount();
    if (!user) {
      return Response.json({ ok: false, error: "Could not open the demo account." }, { status: 500 });
    }
    await createSession(user.id, request);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Demo login failed:", error);
    return Response.json({ ok: false, error: "Could not open the demo account." }, { status: 500 });
  }
}
