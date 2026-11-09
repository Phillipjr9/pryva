import { beginPurchase } from "@/lib/checkout/purchase";
import { quoteCode } from "@/lib/services/foxreload/code-orders";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function POST(request: Request) {
  const begun = await beginPurchase(request, { bucket: "code-quote", maxBodyBytes: 1024, velocity: false });
  if (!begun.ok) return begun.response;
  const productId = begun.body?.productId;
  if (typeof productId !== "string") return Response.json({ ok: false, error: "Invalid product." }, { status: 400 });
  try {
    const result = await quoteCode(begun.user.id, productId);
    if (result.kind !== "quote") return Response.json({ ok: false, error: result.kind === "error" ? result.message : "Quote unavailable." }, { status: result.kind === "error" && result.code === "invalid" ? 400 : 503 });
    return Response.json({ ok: true, quote: result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return Response.json({ ok: false, error: "Quote temporarily unavailable." }, { status: 503 }); }
}
