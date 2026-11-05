import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** The static planning catalogue is not a verified, deliverable offer. */
export async function GET() {
  return NextResponse.json({ error: "Data plans are not available yet." }, { status: 503 });
}
