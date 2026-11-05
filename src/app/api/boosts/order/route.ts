import { afterPurchase, beginPurchase } from "@/lib/checkout/purchase";
import { placeBoostOrder } from "@/lib/services/boosts/boost-orders";
import { normalizeTargetLink } from "@/lib/providers/smm-panel";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Buy a boost.
 *
 * The shared checkout gates cover identity, origin, content type, the financial
 * environment, the limiter and the hourly ceiling; what is left here is the part
 * that is about boosts.
 */
export async function POST(request: Request) {
  const begun = await beginPurchase(request, { bucket: "boost-create", maxBodyBytes: 2_048 });
  if (!begun.ok) return begun.response;
  const { user, body } = begun;

  const fields = body && typeof body === "object" && !Array.isArray(body)
    ? (body as { itemId?: unknown; link?: unknown; quantity?: unknown; requestId?: unknown })
    : {};

  if (typeof fields.itemId !== "string" || !/^live-boost-[0-9a-f]{20}$/.test(fields.itemId)) {
    return Response.json({ ok: false, error: "That boosting service is no longer available." }, { status: 400 });
  }
  const link = normalizeTargetLink(fields.link);
  if (!link) {
    return Response.json(
      { ok: false, error: "Enter the public profile or post link you want boosted (https only)." },
      { status: 400 },
    );
  }
  if (typeof fields.quantity !== "number" || !Number.isSafeInteger(fields.quantity) || fields.quantity <= 0) {
    return Response.json({ ok: false, error: "Enter how many units you want." }, { status: 400 });
  }
  const rawRequestId = fields.requestId;
  if (typeof rawRequestId !== "string" || !UUID.test(rawRequestId)) {
    return Response.json({ ok: false, error: "Invalid purchase request. Please try again." }, { status: 400 });
  }

  try {
    const result = await placeBoostOrder({
      userId: user.id,
      itemId: fields.itemId,
      link,
      quantity: fields.quantity,
      requestId: rawRequestId.toLowerCase(),
    });

    if (result.kind === "invalid") return Response.json({ ok: false, error: result.error }, { status: 400 });
    if (result.kind === "disabled") return Response.json({ ok: false, error: result.error }, { status: 503 });
    if (result.kind === "unavailable") return Response.json({ ok: false, error: result.error }, { status: 502 });
    if (result.kind === "insufficient") {
      return Response.json(
        {
          ok: false,
          error: `Your wallet balance is ₦${result.balance.toLocaleString("en-NG")} — top up to continue.`,
          required: result.required,
          balance: result.balance,
        },
        { status: 402 },
      );
    }

    const order = result.order;
    // A created order may be this customer's first delivery, which is what a
    // referral reward waits for. Best effort, and idempotent.
    if (result.kind !== "replay") void afterPurchase(user.id);
    return Response.json({
      ok: true,
      replayed: result.kind === "replay",
      order: {
        id: order.id,
        reference: order.reference,
        productName: order.productName,
        planLabel: order.planLabel,
        amount: order.amount,
        status: order.status,
        targetLink: order.targetLink ?? link,
        quantity: order.quantity ?? fields.quantity,
      },
      ...(result.kind === "created" ? { balance: result.balance } : {}),
    });
  } catch (error) {
    console.error("Boost order failed", error);
    return Response.json(
      { ok: false, error: "We couldn't place that order right now. Please try again." },
      { status: 500 },
    );
  }
}
