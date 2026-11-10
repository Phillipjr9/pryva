import { authorizeAdminApi } from "@/lib/identity/admin-auth";
import { createRateLimiter } from "@/lib/platform/rate-limit";
import { readCloudflareOverview } from "@/lib/admin/cloudflare-analytics";

export const dynamic = "force-dynamic";
const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10 });
const reply = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

export async function GET(request: Request) {
  const access = await authorizeAdminApi(request);
  if (access.response) return access.response;
  const limit = await limiter(`admin-cloudflare:${access.user.id}`);
  if (limit.unavailable) return reply({ error: "Security data temporarily unavailable." }, 503);
  if (!limit.allowed) return reply({ error: "Please wait before refreshing." }, 429);
  try { return reply(await readCloudflareOverview()); }
  catch { return reply({ error: "Security data temporarily unavailable." }, 503); }
}
