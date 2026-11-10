import { requireAuthApi } from "@/lib/identity/auth";
import { catalogRateLimiter } from "@/lib/platform/rate-limit";
import { readTelegramDisplayPrices } from "@/lib/services/foxreload/telegram-display-prices";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
const reply = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
export async function GET() {
  const user = await requireAuthApi();
  if (!user) return reply({ ok: false, error: "Please sign in." }, 401);
  const limit = await catalogRateLimiter(`telegram-prices:${user.id}`);
  if (limit.unavailable) return reply({ ok: false, error: "Prices temporarily unavailable." }, 503);
  if (!limit.allowed) return reply({ ok: false, error: "Try again shortly." }, 429);
  try { return reply({ ok: true, ...await readTelegramDisplayPrices() }); }
  catch { return reply({ ok: false, error: "Prices temporarily unavailable." }, 503); }
}
