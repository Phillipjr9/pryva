import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { explorerCountry } from "@/lib/service-explorer";
import { demoInventory } from "@/lib/demo-services";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isPreviewDatabase()) return NextResponse.json({ error: "Demo inventory is unavailable here." }, { status: 404 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const country = explorerCountry(request.nextUrl.searchParams.get("country"));
  if (!country) return NextResponse.json({ error: "Choose a country." }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, simulated: true, country: country.code, inventory: demoInventory(user.id, country.code) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load demo counts." }, { status: 500 });
  }
}
