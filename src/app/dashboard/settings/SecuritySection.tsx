import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userTwoFactor } from "@/db/schema";
import { remainingRecoveryCodes, twoFactorAvailable } from "@/lib/two-factor";
import type { PublicUser } from "@/lib/auth";
import { Check, Clock, Shield, User } from "@/components/icons";
import { SessionsCard } from "./SessionsCard";
import { TwoFactorCard } from "./TwoFactorCard";

/**
 * Security, inside Settings rather than beside it.
 *
 * Password, two-factor and sessions are all properties of one account, so they
 * belong on the page that changes that account. A separate `/dashboard/security`
 * route made someone looking for "turn on 2FA" choose between two doors that
 * both sounded right, and `/dashboard/settings` — which is where people went
 * first — had no mention of the second factor at all.
 *
 * `/dashboard/security` still exists and redirects here (see its page.tsx), so
 * old links, bookmarks and the admin sign-in bounce keep working.
 *
 * `id="security"` is the anchor other surfaces link to.
 */
export async function SecuritySection({ user }: { user: PublicUser }) {
  // The cards are client components because enrolment and session revocation are
  // interactive, but whether 2FA is on and whether the deployment can run it are
  // server facts.
  const [enrolment] = await db
    .select({ enabledAt: userTwoFactor.enabledAt })
    .from(userTwoFactor)
    .where(eq(userTwoFactor.userId, user.id))
    .limit(1);
  const twoFactorEnabled = Boolean(enrolment?.enabledAt);
  const recoveryCodesLeft = twoFactorEnabled ? await remainingRecoveryCodes(user.id) : 0;

  return (
    <section id="security" className="scroll-mt-24 space-y-4">
      <div>
        <h2 className="text-[1.15rem] font-medium tracking-tight text-ink">Security</h2>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          How this account is protected, and how to keep it that way.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <TwoFactorCard
          initialEnabled={twoFactorEnabled}
          available={twoFactorAvailable()}
          remainingCodes={recoveryCodesLeft}
        />
        <SessionsCard />
      </div>

      <div className="rounded-[1.5rem] border border-lav-200 bg-gradient-to-br from-lav-50 to-white p-5">
        <h3 className="flex items-center gap-2 text-[0.95rem] font-semibold">
          <Shield className="h-4 w-4 text-lav-700" /> What we do on our side
        </h3>
        <ul className="mt-2.5 grid gap-2 text-[0.8rem] text-ink-2 sm:grid-cols-2">
          {[
            "Session cookies are http-only and expire after 30 days.",
            "Sign-in is rate limited per connection and per account, and locks for 30 minutes after 8 wrong passwords.",
            "Every purchase and refund is written to your wallet ledger, and a nightly job checks the arithmetic.",
            "Administrator access is granted separately, never at sign-up, and requires a second factor.",
          ].map((tip) => (
            <li key={tip} className="flex items-start gap-2">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lav-600" />
              {tip}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
        <h3 className="flex items-center gap-2 text-[0.95rem] font-semibold">
          <User className="h-4 w-4 text-lav-700" /> Habits that keep an account safe
        </h3>
        <ul className="mt-2.5 grid gap-2 text-[0.8rem] text-ink-2">
          {[
            "Don't reuse this password on other sites.",
            "Never share a verification code — we never ask for one.",
            "Treat gift-card codes like cash; they cannot be refunded.",
            "Sign out on shared devices when you're done.",
          ].map((tip) => (
            <li key={tip} className="flex items-start gap-2">
              <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lav-600" />
              {tip}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
