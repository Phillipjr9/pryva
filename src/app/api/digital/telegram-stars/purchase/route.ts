import { beginPurchase } from "@/lib/checkout/purchase";
import { buyTelegramStars } from "@/lib/services/foxreload/stars-orders";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request) {
  const begun = await beginPurchase(request, { bucket: "stars-purchase", maxBodyBytes: 2048 });
  if (!begun.ok) return begun.response;
  const { quoteId, requestId, username } = begun.body ?? {};
  if (typeof quoteId !== "string" || typeof requestId !== "string" || typeof username !== "string") return Response.json({ ok: false, error: "Invalid purchase request." }, { status: 400 });
  try {
    const result = await buyTelegramStars({ userId: begun.user.id, quoteId, requestId, username });
    if (result.kind === "order") return Response.json({ ok: true, order: result }, { status: result.status === "delivered" ? 200 : 202, headers: { "Cache-Control": "private, no-store" } });
    if (result.kind === "error") return Response.json({ ok: false, error: result.message, code: result.code, reference: result.reference }, { status: result.code === "insufficient" ? 402 : result.code === "invalid" ? 400 : result.code === "unavailable" ? 503 : 409 });
    return Response.json({ ok: false, error: "Purchase unavailable." }, { status: 503 });
  } catch {
    return Response.json({ ok: false, error: "Purchase outcome could not be confirmed. Check your orders before trying again.", code: "uncertain" }, { status: 500 });
  }
}
