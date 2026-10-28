import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { advanceDemoOtp, advanceDemoPromotion } from "@/lib/demo-delivery";
import { isSameOriginMutation } from "@/lib/net";
import { demoRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isPreviewDatabase()) return NextResponse.json({ error: "Demo delivery is unavailable here." }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin." }, { status: 403 });
  const { id } = await params;
  if (!/^[a-z0-9-]{1,64}$/i.test(id)) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  const limit = await demoRateLimiter(`demo-delivery:${user.id}:${id}`);
  if (limit.unavailable) return NextResponse.json({ error: "Could not check the demo delivery." }, { status: 503 });
  if (!limit.allowed) return NextResponse.json({ error: "Please wait before checking again." }, { status: 429 });
  try {
    const delivery = advanceDemoOtp(user.id, id) ?? advanceDemoPromotion(user.id, id);
    if (!delivery) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    return NextResponse.json({ ok: true, simulated: true, ...delivery }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not check the demo delivery." }, { status: 500 });
  }
}
