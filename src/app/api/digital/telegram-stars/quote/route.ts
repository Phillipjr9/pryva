import { beginPurchase } from "@/lib/checkout/purchase";
import { quoteTelegramStars } from "@/lib/services/foxreload/stars-orders";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function POST(request: Request) {
  const begun = await beginPurchase(request, { bucket: "stars-quote", maxBodyBytes: 1024, velocity: false });
  if (!begun.ok) return begun.response;
  const quantity = begun.body?.quantity;
  if (typeof quantity !== "number") return Response.json({ ok: false, error: "Enter a valid number of Stars." }, { status: 400 });
  try {
    const result = await quoteTelegramStars(begun.user.id, quantity);
    if (result.kind !== "quote") return Response.json({ ok: false, error: result.kind === "error" ? result.message : "Quote unavailable." }, { status: result.kind === "error" && result.code === "invalid" ? 400 : 503 });
    return Response.json({ ok: true, quote: result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ ok: false, error: "Quote temporarily unavailable." }, { status: 503 });
  }
}
