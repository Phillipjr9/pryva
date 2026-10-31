import { placeBoostOrder } from "@/lib/boost-orders";
import { getCurrentUser } from "@/lib/auth";
import { purchaseVelocity, recordFraudEvent } from "@/lib/fraud";
import { isSameOriginMutation } from "@/lib/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { purchaseRateLimiter } from "@/lib/rate-limit";
import { normalizeTargetLink } from "@/lib/smm-panel";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Buy a boost.
 *
 * Same guard rails as a catalogue purchase — signed in, same origin, JSON,
 * per-minute limiter, hourly purchase ceiling, client-supplied idempotency key —
 * because this spends wallet money exactly like an order does.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ ok: false, error: "Please sign in to complete this order." }, { status: 401 });
  }
  if (!isSameOriginMutation(request)) {
    return Response.json({ ok: false, error: "Cross-origin request denied." }, { status: 403 });
  }
  if (!isJsonRequest(request)) return Response.json({ ok: false, error: "Expected JSON." }, { status: 415 });

  const limit = await purchaseRateLimiter(`boost-create:${user.id}`);
  if (limit.unavailable) return Response.json({ ok: false, error: "Purchases are temporarily unavailable." }, { status: 503 });
  if (!limit.allowed) return Response.json({ ok: false, error: "Too many attempts. Try again later." }, { status: 429 });

  const velocity = await purchaseVelocity(user.id).catch(() => ({ allowed: true, count: 0, limit: 0 }));
  if (!velocity.allowed) {
    await recordFraudEvent({
      userId: user.id,
      kind: "purchase_velocity",
      severity: "warn",
      reasons: [`${velocity.count} orders in the last hour (limit ${velocity.limit})`],
    });
    return Response.json(
      { ok: false, error: "That is a lot of orders in a short time. Please try again in a few minutes." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await readJsonWithLimit(request, 2_048);
  } catch (error) {
    return Response.json(
      { ok: false, error: "Invalid request body." },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }

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
