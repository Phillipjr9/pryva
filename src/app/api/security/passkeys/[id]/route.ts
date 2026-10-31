import { NextResponse } from "next/server";

import { requireAuthApi } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { isSameOriginMutation } from "@/lib/net";
import { deleteCredential, listCredentialSummaries } from "@/lib/passkeys";

export const dynamic = "force-dynamic";

/**
 * Remove one of the account's own passkeys.
 *
 * The ownership check is inside the delete query, so an id belonging to another
 * account removes nothing and answers "not found" — the same answer as an id
 * that never existed.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuthApi();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });

  const { id } = await params;
  try {
    const deleted = await deleteCredential(user.id, id);
    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, passkeys: await listCredentialSummaries(user.id) });
  } catch (error) {
    logger.error("Failed to remove a passkey", { userId: user.id, error });
    return NextResponse.json({ error: "Could not remove that passkey." }, { status: 500 });
  }
}
