import { getCurrentUser } from "@/lib/auth";
import { getFleexaStatus } from "@/lib/fleexa";

export const dynamic = "force-dynamic";

/** Lightweight provider healthcheck for the signed-in dashboard. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const status = await getFleexaStatus();
  return Response.json({ ok: true, fleexa: status });
}
