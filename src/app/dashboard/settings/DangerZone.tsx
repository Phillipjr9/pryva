"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AlertTriangle, CheckCircle, Loader2, Logout, Shield, Trash2, XCircle } from "@/components/icons";
import { DELETION_TERMS, forfeitureWarning } from "@/lib/account-deletion";

/**
 * Closing the account, on the customer's own terms.
 *
 * Two things this screen refuses to do, both of which the old one did:
 *
 *   • **It does not hide the price.** Before anything is typed, the panel lists
 *     what stops existing (identity, credentials, devices) and what does not
 *     (orders, wallet history, payment references, fraud signals — with the reason
 *     for each). "Delete my account" is not consent to an undisclosed retention
 *     policy, and the list here is the same data the endpoint acts on.
 *   • **It does not make it a single click.** The customer types their own address
 *     and, where the account has one, their password. A mis-click cannot end an
 *     account.
 *
 * A refusal is shown as a sentence with a way out — a balance to withdraw, a
 * withdrawal to wait for, a session too old to be trusted — never as a dead button.
 */

type Failure = {
  error?: string;
  code?: string;
  action?: { label: string; href: string };
};

export function DangerZone({
  email,
  walletBalance,
  hasPassword,
}: {
  email: string;
  walletBalance: number;
  hasPassword: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typedEmail, setTypedEmail] = useState("");
  const [password, setPassword] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [forfeitAcknowledged, setForfeitAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Failure | null>(null);
  const [done, setDone] = useState<{ retained: Record<string, number>; forfeited: number } | null>(null);

  const emailMatches = typedEmail.trim().toLowerCase() === email.trim().toLowerCase();
  // Money on the table gets its own acknowledgement, in the amount the customer
  // is giving up — a second tick, not a sentence inside a longer one.
  const forfeiture = forfeitureWarning(walletBalance);
  const canSubmit =
    emailMatches &&
    understood &&
    (!forfeiture || forfeitAcknowledged) &&
    (!hasPassword || password.length > 0) &&
    !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/user/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: typedEmail,
          password: hasPassword ? password : undefined,
          forfeitAcknowledged: forfeiture ? true : undefined,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as Failure & {
        ok?: boolean;
        deleted?: boolean;
        retained?: Record<string, number>;
        forfeited?: number;
      };
      if (!response.ok || !data.ok) {
        setError(data);
        return;
      }
      setDone({ retained: data.retained ?? {}, forfeited: data.forfeited ?? 0 });
      // The session cookie is gone; the shell this page sits in is not.
      router.refresh();
    } catch {
      setError({
        error: "That did not go through — the connection dropped. Nothing was changed; please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50/50 p-5" aria-live="polite">
        <div className="flex items-start gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
            <CheckCircle className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-[0.95rem] font-semibold text-emerald-900">Your account is closed</h2>
            <p className="mt-1 text-meta leading-relaxed text-emerald-900/80">
              You have been signed out on every device, and the address on this account no longer exists. The
              records below were kept, without your name or email attached — nothing in them identifies you.
            </p>
            <ul className="mt-2.5 grid gap-1 text-meta text-emerald-900/80">
              {Object.entries(done.retained)
                .filter(([, value]) => value > 0)
                .map(([key, value]) => (
                  <li key={key} className="flex items-center justify-between rounded-lg bg-white/70 px-3 py-1.5">
                    <span>{RETAINED_LABELS[key] ?? key}</span>
                    <span className="font-semibold">{value}</span>
                  </li>
                ))}
              {Object.values(done.retained).every((value) => !value) ? (
                <li className="rounded-lg bg-white/70 px-3 py-1.5">
                  Nothing to keep: this account never made a purchase.
                </li>
              ) : null}
              {done.forfeited > 0 ? (
                <li className="flex items-center justify-between rounded-lg bg-white/70 px-3 py-1.5">
                  <span>Balance forfeited</span>
                  <span className="font-semibold">₦{done.forfeited.toLocaleString()}</span>
                </li>
              ) : null}
            </ul>
            <p className="mt-3 text-meta text-emerald-900/70">
              If you write to support later, mention the reference of the order or payout you are asking about —
              that is what the retained record is found by.
            </p>
            <Link
              href="/"
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-ink px-4 py-2 text-[0.82rem] font-semibold text-white hover:bg-ink-2"
            >
              <Logout className="h-3.5 w-3.5" /> Leave
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section id="close-account" className="rounded-[1.5rem] border border-rose-200 bg-rose-50/30 p-5">
      <div className="flex items-start gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-rose-100 text-rose-700">
          <AlertTriangle className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[0.95rem] font-semibold">Close my account</h2>
          <p className="mt-0.5 text-meta leading-relaxed text-ink-2">
            You can close your account here, without asking anyone. Your details are removed; the record of what
            the account paid for and was paid is kept, because a bank or a payment provider can ask about it
            months later.
          </p>
        </div>
      </div>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="btn mt-3.5 w-fit border border-rose-300 bg-white !px-4 !py-2.5 !text-[0.8rem] text-rose-800 hover:border-rose-400"
        >
          <Trash2 className="h-3.5 w-3.5" /> Show me what happens
        </button>
      ) : (
        <div className="mt-4 grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-white p-3.5">
              <p className="flex items-center gap-1.5 text-[0.82rem] font-semibold text-ink">
                <XCircle className="h-3.5 w-3.5 text-rose-600" /> Removed
              </p>
              <ul className="mt-2 grid gap-1.5 text-meta text-ink-2">
                {DELETION_TERMS.removed.map((item) => (
                  <li key={item} className="flex gap-1.5">
                    <span aria-hidden="true" className="text-rose-500">
                      ·
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-line bg-white p-3.5">
              <p className="flex items-center gap-1.5 text-[0.82rem] font-semibold text-ink">
                <Shield className="h-3.5 w-3.5 text-emerald-600" /> Kept, without your name
              </p>
              <ul className="mt-2 grid gap-2 text-meta text-ink-2">
                {DELETION_TERMS.kept.map((item) => (
                  <li key={item.what}>
                    <span className="font-semibold text-ink">{item.what}.</span> {item.why}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <p className="rounded-xl bg-white/80 px-3.5 py-2.5 text-meta leading-relaxed text-ink-2">
            {DELETION_TERMS.summary}
          </p>

          {forfeiture ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-meta leading-relaxed text-amber-900">
              <p className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  <span className="font-semibold">You will lose ₦{forfeiture.amount.toLocaleString()}.</span>{" "}
                  Closing your account forfeits the balance in it — it is not refunded, cannot be withdrawn
                  afterwards, and nobody will be able to claim it. Withdraw it first if you want to keep it:{" "}
                  <Link href="/dashboard/wallet" className="font-semibold underline">
                    go to wallet
                  </Link>
                  .
                </span>
              </p>
              <label className="mt-2.5 flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={forfeitAcknowledged}
                  onChange={(event) => setForfeitAcknowledged(event.target.checked)}
                  className="mt-0.5"
                  disabled={busy}
                />
                I understand my ₦{forfeiture.amount.toLocaleString()} will be forfeited and I cannot claim it
                afterwards.
              </label>
            </div>
          ) : null}

          <div className="grid gap-3">
            <label className="grid gap-1.5 text-meta font-medium text-ink-2">
              Type <span className="font-semibold text-ink">{email}</span> to confirm
              <input
                type="email"
                value={typedEmail}
                onChange={(event) => setTypedEmail(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="field w-full"
                placeholder={email}
                disabled={busy}
              />
            </label>

            {hasPassword ? (
              <label className="grid gap-1.5 text-meta font-medium text-ink-2">
                Your password
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  className="field w-full"
                  disabled={busy}
                />
              </label>
            ) : (
              <p className="text-meta leading-relaxed text-ink-3">
                This account signs in with Google, so there is no password to type. Your recent sign-in is the
                confirmation.
              </p>
            )}

            <label className="flex items-start gap-2 text-meta leading-relaxed text-ink-2">
              <input
                type="checkbox"
                checked={understood}
                onChange={(event) => setUnderstood(event.target.checked)}
                className="mt-0.5"
                disabled={busy}
              />
              I understand what is removed and what is kept, and that this cannot be undone.
            </label>
          </div>

          {error ? (
            <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-meta text-rose-800">
              <p>{error.error ?? "The account could not be closed. Please try again."}</p>
              {error.action ? (
                <Link href={error.action.href} className="mt-1 inline-flex font-semibold underline">
                  {error.action.label}
                </Link>
              ) : null}
              {error.code === "SESSION_TOO_OLD" ? (
                <Link href="/login" className="mt-1 inline-flex font-semibold underline">
                  Sign in again
                </Link>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSubmit}
              className="btn w-fit !px-4 !py-2.5 !text-[0.8rem] bg-rose-700 text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Closing…
                </>
              ) : (
                <>
                  <Trash2 className="h-3.5 w-3.5" /> Delete my account permanently
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="btn w-fit border border-line bg-white !px-4 !py-2.5 !text-[0.8rem] text-ink-2 hover:border-lav-300 disabled:opacity-50"
            >
              Keep my account
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** The receipt's counters, in the words the panel used before the fact. */
const RETAINED_LABELS: Record<string, string> = {
  orders: "Orders",
  walletTransactions: "Wallet transactions",
  deposits: "Deposits",
  withdrawals: "Withdrawals",
  giftCards: "Gift cards",
  supportTickets: "Support conversations",
  reviews: "Reviews",
};
