import { headers } from "next/headers";

import { requireUser } from "@/lib/auth";
import { publicOrigin } from "@/lib/net";
import { referralOverview } from "@/lib/referrals";
import { ReferralProgram } from "./ReferralProgram";

export const metadata = { title: "Refer a friend" };
export const dynamic = "force-dynamic";

/**
 * Invite a friend, and see what the invitations have earned.
 *
 * The code is minted the first time somebody opens this page, so the link exists
 * before it is needed. Everything on the page is this account's own: the overview
 * is queried by user id, and the invite rows show a masked address — enough for
 * the customer to recognise who joined, not enough to build a mailing list out of
 * other people's addresses.
 */
export default async function ReferralsPage() {
  const user = await requireUser("/dashboard/referrals");
  const headerList = await headers();
  const origin = publicOrigin(
    new Request(`https://${headerList.get("host") ?? "localhost"}/`, { headers: headerList }),
  );
  const overview = await referralOverview(user.id);

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-[1.5rem] font-medium tracking-tight text-ink sm:text-[1.7rem]">Refer a friend</h1>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          Share your link. When a friend joins and their first order is delivered, part of it comes back
          to your wallet.
        </p>
      </div>

      <ReferralProgram
        code={overview.code}
        link={overview.code ? `${origin}/signup?ref=${overview.code}` : null}
        earned={overview.earned}
        invited={overview.invited}
        pending={overview.pending}
        percent={overview.percent}
        capNgn={overview.capNgn}
        invites={overview.invites}
      />
    </div>
  );
}
