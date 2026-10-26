import { createSession } from "@/lib/auth";
import { openDemoAccount } from "@/lib/demo";

export const dynamic = "force-dynamic";

/** JSON demo login (used by fetch-based clients). */
export async function POST(request: Request) {
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
