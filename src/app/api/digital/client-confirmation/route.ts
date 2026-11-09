import { beginPurchase } from "@/lib/checkout/purchase";
import { requireAuthApi } from "@/lib/identity/auth";
import { financialActionsUnavailable } from "@/lib/platform/financial-environment";
import { createRateLimiter } from "@/lib/platform/rate-limit";
import { inspectClientConfirmation, submitClientConfirmation } from "@/lib/services/foxreload/client-confirmation";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const limiter = createRateLimiter({ windowMs: 20_000, maxRequests: 1 });
const reply = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function GET(request: Request) {
  const user = await requireAuthApi();
  if (!user) return Response.json({ ok: false, error: "Please sign in." }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  if (financialActionsUnavailable()) return reply({ ok: false, error: "Confirmation is unavailable." }, 503);
  const orderId = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) return reply({ ok: false, error: "Order not found." }, 404);
  const allowed = await limiter(`client-confirmation:${user.id}:${orderId}`);
  if (allowed.unavailable) return reply({ ok: false, error: "Confirmation is temporarily unavailable." }, 503);
  if (!allowed.allowed) return reply({ ok: false, error: "Try again shortly." }, 429);
  try {
    const result = await inspectClientConfirmation(user.id, orderId);
    if (result.kind === "unavailable") return reply({ ok: false, error: "Confirmation is unavailable." }, 503);
    if (result.kind === "not-found") return reply({ ok: false, error: "Order not found." }, 404);
    return reply({ ok: true, required: result.kind === "waiting", blocked: result.kind === "blocked" });
  } catch { return reply({ ok: false, error: "Could not check confirmation. Try again later." }, 503); }
}
export async function POST(request: Request) {
  const begun = await beginPurchase(request, { bucket: "client-confirmation", maxBodyBytes: 1024, velocity: false });
  if (!begun.ok) return begun.response;
  const { orderId, code } = begun.body ?? {};
  if (typeof orderId !== "string" || typeof code !== "string" || !/^[A-Za-z0-9 ._-]{1,255}$/.test(code.trim())) return reply({ ok: false, error: "Invalid confirmation request." }, 400);
  try {
    const result = await submitClientConfirmation(begun.user.id, orderId, code);
    if (result === "submitted") return reply({ ok: true, message: "Code submitted. Check delivery status later." });
    if (result === "rejected") return reply({ ok: false, error: "That code was rejected. Request a fresh code and try again." }, 400);
    if (result === "uncertain") return reply({ ok: false, error: "The result is not confirmed. Contact support before submitting another code." }, 409);
    return reply({ ok: false, error: "This order is not ready for a code. Check its status or contact support." }, 409);
  } catch { return reply({ ok: false, error: "The result is not confirmed. Contact support before submitting another code." }, 503); }
}
