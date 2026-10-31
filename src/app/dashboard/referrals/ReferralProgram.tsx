"use client";

import { useState } from "react";

import { AlertCircle, Check, Copy, Gift, Send, Users } from "@/components/icons";
import type { ReferralInvite } from "@/lib/referrals";

type Props = {
  code: string | null;
  link: string | null;
  earned: number;
  invited: number;
  pending: number;
  percent: number;
  capNgn: number;
  invites: ReferralInvite[];
};

function formatNaira(amount: number) {
  return `₦${amount.toLocaleString("en-NG")}`;
}

function shortDate(value: string) {
  return new Date(value).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" });
}

const STATUS_COPY: Record<string, { label: string; className: string }> = {
  pending: { label: "Waiting for their first order", className: "border-amber-200 bg-amber-50 text-amber-800" },
  credited: { label: "Paid", className: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  void: { label: "Not payable", className: "border-slate-200 bg-slate-50 text-slate-600" },
};

/**
 * Invite a friend.
 *
 * The copy button is the whole feature on this screen: a referral link is only
 * ever useful after it has left the browser. `navigator.clipboard` needs a
 * secure context and permission, so it is treated as an enhancement — the code
 * and the link are both selected text, and the button says so when it fails
 * instead of silently doing nothing.
 */
export function ReferralProgram({ code, link, earned, invited, pending, percent, capNgn, invites }: Props) {
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function copy(value: string, which: "link" | "code") {
    setError(null);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      window.setTimeout(() => setCopied(null), 2_000);
    } catch {
      setError("Your browser blocked the clipboard. Select the text and copy it by hand.");
    }
  }

  if (!code || !link) {
    return (
      <div className="rounded-2xl border border-line bg-white p-5">
        <p className="flex items-start gap-2 text-[0.86rem] text-ink-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          Invite codes are unavailable right now. Please try again in a moment.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <section className="rounded-[1.5rem] border border-lav-200 bg-gradient-to-br from-lav-50 to-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-[1rem] font-semibold text-ink">
              <Gift className="h-4 w-4 text-lav-700" /> Your invite link
            </h2>
            <p className="mt-1 max-w-xl text-[0.85rem] leading-relaxed text-ink-2">
              When someone joins with your link and their first order is delivered, you earn{" "}
              <strong className="text-ink">{percent}%</strong> of that order in your wallet — up to{" "}
              <strong className="text-ink">{formatNaira(capNgn)}</strong>. Once per friend.
            </p>
          </div>
          <div className="text-right">
            <p className="text-micro uppercase tracking-[0.14em] text-ink-3">Earned so far</p>
            <p className="text-[1.4rem] font-semibold tracking-tight text-ink">{formatNaira(earned)}</p>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <code className="flex-1 select-all truncate rounded-xl border border-line bg-white px-3 py-2.5 font-mono text-[0.82rem] text-ink">
            {link}
          </code>
          <button
            type="button"
            onClick={() => void copy(link, "link")}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-[0.82rem] font-semibold text-white hover:bg-ink-2"
          >
            {copied === "link" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied === "link" ? "Copied" : "Copy link"}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[0.8rem] text-ink-2">
          <span className="text-ink-3">Or share the code</span>
          <code className="select-all rounded-lg border border-line bg-white px-2 py-1 font-mono tracking-[0.18em]">
            {code}
          </code>
          <button
            type="button"
            onClick={() => void copy(code, "code")}
            className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-ink-2 hover:bg-lav-50"
          >
            {copied === "code" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied === "code" ? "Copied" : "Copy"}
          </button>
        </div>

        {error ? (
          <p role="alert" className="mt-3 flex items-start gap-1.5 text-[0.8rem] font-medium text-rose-700">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </p>
        ) : null}
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Friends joined", value: String(invited) },
          { label: "Waiting for a first order", value: String(pending) },
          { label: "Paid to you", value: formatNaira(earned) },
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl border border-line bg-white px-4 py-3">
            <p className="text-micro uppercase tracking-[0.12em] text-ink-3">{stat.label}</p>
            <p className="mt-1 text-[1.1rem] font-semibold text-ink">{stat.value}</p>
          </div>
        ))}
      </div>

      <section className="rounded-2xl border border-line bg-white p-5">
        <h2 className="flex items-center gap-2 text-[0.95rem] font-semibold text-ink">
          <Users className="h-4 w-4 text-lav-700" /> People you invited
        </h2>
        {invites.length === 0 ? (
          <p className="mt-2 text-[0.86rem] text-ink-2">
            Nobody yet. Share the link above — the reward arrives after their first order is delivered.
          </p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {invites.map((invite) => {
              const status = STATUS_COPY[invite.status] ?? {
                label: invite.status,
                className: "border-slate-200 bg-slate-50 text-slate-600",
              };
              return (
                <li
                  key={invite.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-[#fffdfa] px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-[0.85rem] font-medium text-ink">{invite.refereeLabel}</p>
                    <p className="text-micro text-ink-3">Joined {shortDate(invite.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {invite.status === "credited" && invite.rewardAmount ? (
                      <span className="text-[0.85rem] font-semibold text-emerald-700">
                        +{formatNaira(invite.rewardAmount)}
                      </span>
                    ) : null}
                    <span className={`rounded-full border px-2 py-0.5 text-micro font-medium ${status.className}`}>
                      {status.label}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-[#fffdfa] p-5">
        <h2 className="flex items-center gap-2 text-[0.95rem] font-semibold text-ink">
          <Send className="h-4 w-4 text-lav-700" /> How it works
        </h2>
        <ol className="mt-2 grid gap-1.5 text-[0.84rem] leading-relaxed text-ink-2">
          <li>1. Share your link or code — wherever you like.</li>
          <li>2. They create an account with it. Codes are counted once per person.</li>
          <li>
            3. When their first order is delivered, {percent}% of it (up to {formatNaira(capNgn)}) lands in
            your wallet automatically.
          </li>
        </ol>
        <p className="mt-3 text-micro leading-relaxed text-ink-3">
          An order that is refunded or never delivered does not earn a reward, and inviting yourself does
          not either. Rewards are wallet credit — they can be spent on any service, and are not cashable.
        </p>
      </section>
    </div>
  );
}
