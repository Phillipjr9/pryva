import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Old account-closure email links must never erase an identity after a ban has
// become a reversible suspension. GET remains non-mutating, and POST is retired.
function retired() {
  return NextResponse.json({ error: "This closure link is no longer valid. Contact support for assistance." }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
export const GET = retired;
export const POST = retired;
