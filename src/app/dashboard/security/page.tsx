import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { SessionsCard } from "./SessionsCard";
import { ArrowRight, Check, Clock, Lock, Shield, User } from "@/components/icons";

export const metadata = { title: "Security" };

// Shell comes from the dashboard layout; this page supplies content only.
export default async function SecurityPage() {
  await requireUser("/dashboard/security");

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

      <div className="grid gap-3 sm:grid-cols-2">
        <section className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-lav-50 text-lav-700">
            <Lock className="h-4 w-4" />
          </span>
          <h2 className="mt-3 text-[0.95rem] font-semibold">Password</h2>
          <p className="mt-1 text-[0.8rem] leading-relaxed text-ink-2">
            Change it from Settings. Use something long and unique — this is the only key to your
            wallet and order history.
          </p>
          <Link
            href="/dashboard/settings"
            className="mt-3 inline-flex items-center gap-1 text-[0.76rem] font-semibold text-lav-700 hover:underline"
          >
            Change password <ArrowRight className="h-3 w-3" />
          </Link>
        </section>

        <section className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
          <div className="flex items-start justify-between gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-lav-50 text-lav-700">
              <Shield className="h-4 w-4" />
            </span>
            <span className="rounded-full border border-line bg-white px-2.5 py-1 text-[0.64rem] font-semibold text-ink-3">
              Not yet available
            </span>
          </div>
          <h2 className="mt-3 text-[0.95rem] font-semibold">Two-factor authentication</h2>
          <p className="mt-1 text-[0.8rem] leading-relaxed text-ink-2">
            An app code on every sign-in. We&apos;re adding it — accounts here are preview-only until
            then, so there is nothing to steal yet.
          </p>
        </section>

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
            "Demo sessions can never become an administrator account.",
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
