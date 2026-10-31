import { NextResponse } from "next/server";

import { requireAuthApi } from "@/lib/auth";
import { publicOrigin } from "@/lib/net";
import { referralOverview } from "@/lib/referrals";

export const dynamic = "force-dynamic";

/**
 * GET /api/referrals
 *
 * The signed-in account's invite code, link and the invitations it has made.
 *
 * Account-scoped in the query, not filtered after the fact: the count and the
 * list are this customer's, and no route parameter can point it at anyone else.
 */
export async function GET(request: Request) {
  const user = await requireAuthApi();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const overview = await referralOverview(user.id);
  return NextResponse.json(
    {
      ok: true,
      code: overview.code,
      link: overview.code ? `${publicOrigin(request)}/signup?ref=${overview.code}` : null,
      earned: overview.earned,
      invited: overview.invited,
      pending: overview.pending,
      percent: overview.percent,
      capNgn: overview.capNgn,
      invites: overview.invites,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
