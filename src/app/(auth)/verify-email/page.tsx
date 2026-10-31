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
const secondary =
  "inline-flex items-center justify-center rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50";

function VerifyEmail() {
  const token = useSearchParams().get("token");
  // Derived during render, not set inside the effect: a synchronous setState in an
  // effect body is what react-hooks/set-state-in-effect rejects.
  const [outcome, setOutcome] = useState<Outcome | null>(token ? { status: "working" } : null);
  const [sending, setSending] = useState(false);
  const [needsSignIn, setNeedsSignIn] = useState(false);

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
    setNeedsSignIn(false);
    try {
      const response = await fetch("/api/auth/verify-email", { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.status === 401) {
        // The link is sent to the address on the account, so an anonymous visitor
        // cannot use this button. Saying "sign in" is the only useful answer.
        setNeedsSignIn(true);
        setOutcome({ status: "sendFailed", message: data.error || "Sign in to request a link." });
      } else {
        setOutcome(
          response.ok
            ? { status: "sent" }
            : { status: "sendFailed", message: data.error || "Could not send that email." },
        );
      }
    } catch {
      setOutcome({ status: "sendFailed", message: "Could not reach the server." });
    } finally {
      setSending(false);
    }
  }, []);

  /*
    Order matters, and it was the bug.

    This page previously checked `!token` first, so the intro block rendered
    whatever happened next: pressing "Email me a link" sent the request, stored
    its result, and changed nothing on screen. "Link sent" and "we could not send
    that email" were both unreachable without a token in the URL — which is
    exactly the state someone is in when they press that button.

    The result branches therefore come first, and the intro is what is left when
    there is no token and no result yet.
  */
  const panel = (() => {
    if (outcome?.status === "sent") {
      return (
        <>
          <h1 className="text-xl font-semibold text-slate-900">Link sent</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Check your inbox. The link expires in 24 hours and works once. If it is not there in a
            minute, look in spam — and try again, which replaces the earlier link.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link className={button} href="/dashboard">
              Back to dashboard
            </Link>
          </div>
        </>
      );
    }

    if (outcome?.status === "sendFailed") {
      /*
        Its own branch rather than sharing the invalid-link one. A send failure is
        the server saying it could not deliver — including the honest answers it
        now returns when no mail provider is configured or the provider refuses
        the send — so appending "It may have expired or already been used" would
        contradict the very message the endpoint was changed to tell the truth
        about. There was often no link involved at all.
      */
      return (
        <>
          <h1 className="text-xl font-semibold text-slate-900">
            {needsSignIn ? "Sign in to get a link" : "We could not send that email"}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">{outcome.message}</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            {needsSignIn
              ? "The confirmation link goes to the address on your account, so we need you signed in first."
              : "Nothing is wrong with your account, and no link was used up. Try again shortly, or contact support if it keeps happening."}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            {needsSignIn ? (
              <Link className={button} href="/login?next=%2Fverify-email">
                Sign in
              </Link>
            ) : (
              <button className={button} onClick={resend} disabled={sending} type="button">
                {sending ? "Sending…" : "Try again"}
              </button>
            )}
            <Link className={secondary} href={needsSignIn ? "/verify-email" : "/dashboard"}>
              {needsSignIn ? "Back" : "Back to dashboard"}
            </Link>
          </div>
        </>
      );
    }

    if (!token) {
      return (
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
      );
    }

    if (outcome?.status === "verified") {
      return (
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
      );
    }

    if (outcome?.status === "invalid") {
      return (
        <>
          <h1 className="text-xl font-semibold text-slate-900">That link did not work</h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            {outcome.message} It may have expired or already been used.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button className={button} onClick={resend} disabled={sending} type="button">
              {sending ? "Sending…" : "Send a new link"}
            </button>
            <Link className={secondary} href="/login">
              Sign in
            </Link>
          </div>
        </>
      );
    }

    return (
      <>
        <h1 className="text-xl font-semibold text-slate-900">Confirming…</h1>
        <p className="mt-2 text-sm text-slate-600">Checking that link now.</p>
      </>
    );
  })();

  return (
    <main className={shell}>
      <div className={card}>{panel}</div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <main className={shell}>
          <div className={card}>Loading…</div>
        </main>
      }
    >
      <VerifyEmail />
    </Suspense>
  );
}
