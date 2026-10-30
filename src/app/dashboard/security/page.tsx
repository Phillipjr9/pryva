import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth";
import { db } from "@/db";
import { userTwoFactor } from "@/db/schema";
import { remainingRecoveryCodes, twoFactorAvailable } from "@/lib/two-factor";
import { SessionsCard } from "./SessionsCard";
import { TwoFactorCard } from "./TwoFactorCard";
import { ArrowRight, Check, Clock, Lock, Shield, User } from "@/components/icons";

export const metadata = { title: "Security" };

// Shell comes from the dashboard layout; this page supplies content only.
export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ require?: string; next?: string }>;
}) {
  const user = await requireUser("/dashboard/security");
  const params = await searchParams;
  // Set by `requireAdmin` when an administrator has no second factor yet: the
  // admin tools are closed until this page is finished, and saying so here is
  // more useful than a 403 on a page they cannot open.
  const needsSecondFactor = params.require === "2fa";

  // The card is a client component because enrolment is interactive, but whether
  // 2FA is on and whether the deployment can run it are server facts.
  const [enrolment] = await db
    .select({ enabledAt: userTwoFactor.enabledAt })
    .from(userTwoFactor)
    .where(eq(userTwoFactor.userId, user.id))
    .limit(1);
  const twoFactorEnabled = Boolean(enrolment?.enabledAt);
  const recoveryCodesLeft = twoFactorEnabled ? await remainingRecoveryCodes(user.id) : 0;

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-[1.5rem] font-medium tracking-tight text-ink sm:text-[1.7rem]">
          Security
        </h1>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          How this account is protected, and how to keep it that way.
        </p>
      </div>

      {needsSecondFactor && (
        <div
          role="status"
          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[0.86rem] text-amber-900"
        >
          <p className="font-semibold">Administrator tools are locked until two-factor is on.</p>
          <p className="mt-1">
            Your account can approve withdrawals and issue refunds, so it needs a second factor
            before it can do either. Turn it on below
            {params.next ? ` and you will be returned to ${params.next}` : ""} — if this deployment
            has no two-factor key configured, tell the operator instead of trying again.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <section className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-lav-50 text-lav-700">
            <Lock className="h-4 w-4" />
          </span>
          <h2 className="mt-3 text-[0.95rem] font-semibold">Password</h2>
          <p className="mt-1 text-[0.8rem] leading-relaxed text-ink-2">
            Change your password from Settings. Use something long and unique to protect your account.
          </p>
          <Link
            href="/dashboard/settings"
            className="mt-3 inline-flex items-center gap-1 text-meta font-semibold text-lav-700 hover:underline"
          >
            Change password <ArrowRight className="h-3 w-3" />
          </Link>
        </section>

        <TwoFactorCard
          initialEnabled={twoFactorEnabled}
          available={twoFactorAvailable()}
          remainingCodes={recoveryCodesLeft}
        />

        <SessionsCard />
      </div>

      <section className="rounded-[1.5rem] border border-lav-200 bg-gradient-to-br from-lav-50 to-white p-5">
        <h2 className="flex items-center gap-2 text-[0.95rem] font-semibold">
          <Shield className="h-4 w-4 text-lav-700" /> What we do on our side
        </h2>
        <ul className="mt-2.5 grid gap-2 text-[0.8rem] text-ink-2 sm:grid-cols-2">
          {[
            "Session cookies are http-only and expire after 30 days.",
            "Sign-in attempts are rate limited per IP.",
            "Every purchase and refund is written to your wallet ledger.",
            "Administrator access is granted separately, never at sign-up.",
          ].map((tip) => (
            <li key={tip} className="flex items-start gap-2">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lav-600" />
              {tip}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
        <h2 className="flex items-center gap-2 text-[0.95rem] font-semibold">
          <User className="h-4 w-4 text-lav-700" /> Habits that keep an account safe
        </h2>
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
      </section>
    </div>
  );
}
