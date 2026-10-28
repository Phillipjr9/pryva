import { clientIp } from "@/lib/auth-rate-limit";
import { giftCardIpRateLimiter, giftCardUserRateLimiter } from "@/lib/rate-limit";

/** Normalize a bearer code without accepting arbitrary database input. */
export function normalizeGiftCardCode(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const code = value.trim().toUpperCase();
  return /^PRYVA-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}(?:-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}){2}$/.test(code) ? code : null;
}

/** Check and redemption share both budgets to prevent moving guesses between routes. */
export async function giftCardAttemptLimit(request: Request, userId: string): Promise<Response | null> {
  const ip = await giftCardIpRateLimiter(`gift-card:ip:${clientIp(request)}`);
  if (ip.unavailable) return Response.json({ error: "Gift card service temporarily unavailable." }, { status: 503 });
  if (!ip.allowed) return Response.json({ error: "Too many gift card attempts. Please try again later." }, { status: 429 });
  const user = await giftCardUserRateLimiter(`gift-card:user:${userId}`);
  if (user.unavailable) return Response.json({ error: "Gift card service temporarily unavailable." }, { status: 503 });
  if (!user.allowed) return Response.json({ error: "Too many gift card attempts. Please try again later." }, { status: 429 });
  return null;
}
