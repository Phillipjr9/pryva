import { NextResponse } from "next/server";

import { requireAuthApi } from "@/lib/auth";
import { listCredentialSummaries } from "@/lib/passkeys";

export const dynamic = "force-dynamic";

/** The signed-in account's passkeys. Metadata only — no public keys leave here. */
export async function GET() {
  const user = await requireAuthApi();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return NextResponse.json(
    { passkeys: await listCredentialSummaries(user.id) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
