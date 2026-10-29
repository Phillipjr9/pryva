"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type Outcome =
  | { status: "working" }
  | { status: "verified" }
  | { status: "invalid"; message: string }
  | { status: "sent" }
  | { status: "sendFailed"; message: string };

const shell = "mx-auto flex w-full max-w-md flex-col gap-4 px-5 py-14";
const card = "rounded-2xl border border-slate-200 bg-white p-6 shadow-sm";
const button =
  "inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60";

function VerifyEmail() {
  const token = useSearchParams().get("token");
  // Derived during render, not set inside the effect: a synchronous setState in an
  // effect body is what react-hooks/set-state-in-effect rejects.
  const [outcome, setOutcome] = useState<Outcome | null>(token ? { status: "working" } : null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/auth/verify-email/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        if (cancelled) return;
        setOutcome(
          response.ok
            ? { status: "verified" }
            : { status: "invalid", message: data.error || "That link did not work." },
        );
      } catch {
        if (!cancelled) setOutcome({ status: "invalid", message: "Could not reach the server." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // "Start sending" lives in the handler, not the effect, for the same reason.
  const resend = useCallback(async () => {
    setSending(true);
    try {
      const response = await fetch("/api/auth/verify-email", { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setOutcome(
        response.ok
          ? { status: "sent" }
          : { status: "sendFailed", message: data.error || "Could not send that email." },
      );
    } catch {
      setOutcome({ status: "sendFailed", message: "Could not reach the server." });
    } finally {
      setSending(false);
    }
  }, []);

  return (
    <main className={shell}>
      <div className={card}>
        {!token ? (
          <>
            <h1 className="text-xl font-semibold text-slate-900">Confirm your email</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Sign in and we will send a fresh confirmation link to the address on your account.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link className={button} href="/login?next=%2Fverify-email">
                Sign in
              </Link>
              <button className={button} onClick={resend} disabled={sending} type="button">
                {sending ? "Sending…" : "Email me a link"}
              </button>
            </div>
          </>
        ) : outcome?.status === "working" ? (
          <>
            <h1 className="text-xl font-semibold text-slate-900">Confirming…</h1>
            <p className="mt-2 text-sm text-slate-600">Checking that link now.</p>
          </>
        ) : outcome?.status === "verified" ? (
          <>
            <h1 className="text-xl font-semibold text-slate-900">Email confirmed</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Your address is verified. You can close this tab.
            </p>
            <div className="mt-5">
              <Link className={button} href="/dashboard">
                Go to your dashboard
              </Link>
            </div>
          </>
        ) : outcome?.status === "sent" ? (
          <>
            <h1 className="text-xl font-semibold text-slate-900">Link sent</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Check your inbox. The link expires in 24 hours and works once.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-slate-900">That link did not work</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              {outcome && "message" in outcome ? outcome.message : null} It may have expired or
              already been used.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button className={button} onClick={resend} disabled={sending} type="button">
                {sending ? "Sending…" : "Send a new link"}
              </button>
              <Link
                className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                href="/login"
              >
                Sign in
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<main className={shell}><div className={card}>Loading…</div></main>}>
      <VerifyEmail />
    </Suspense>
  );
}
