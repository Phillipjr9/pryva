"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

const shell = "mx-auto flex w-full max-w-md flex-col gap-4 px-5 py-14";
const card = "rounded-2xl border border-slate-200 bg-white p-6 shadow-sm";

type Outcome =
  | { status: "working" }
  | { status: "confirmed"; email: string }
  | { status: "invalid"; message: string };

function ConfirmEmailChange() {
  const token = useSearchParams().get("token");
  const [outcome, setOutcome] = useState<Outcome | null>(token ? { status: "working" } : null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/auth/confirm-email-change", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = (await response.json().catch(() => ({}))) as { email?: string; error?: string };
        if (cancelled) return;
        setOutcome(
          response.ok && data.email
            ? { status: "confirmed", email: data.email }
            : { status: "invalid", message: data.error || "That link did not work." },
        );
      } catch {
        if (!cancelled) setOutcome({ status: "invalid", message: "We couldn't reach the server. Try the link again." });
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  return (
    <div className={shell}>
      <div className={card}>
        {!token && (
          <>
            <h1 className="text-[1.2rem] font-semibold text-slate-900">This link is incomplete</h1>
            <p className="mt-2 text-[0.9rem] text-slate-600">
              Open the confirmation link from your email again, or start the change from your settings page.
            </p>
          </>
        )}
        {outcome?.status === "working" && (
          <>
            <h1 className="text-[1.2rem] font-semibold text-slate-900">Confirming your new address…</h1>
            <p className="mt-2 text-[0.9rem] text-slate-600">This takes a second.</p>
          </>
        )}
        {outcome?.status === "confirmed" && (
          <>
            <h1 className="text-[1.2rem] font-semibold text-slate-900">Address confirmed</h1>
            <p className="mt-2 text-[0.9rem] text-slate-600">
              <strong>{outcome.email}</strong> is now the email you sign in with. We told your previous address it changed.
            </p>
            <Link href="/dashboard/settings" className="mt-4 inline-flex rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">
              Back to settings
            </Link>
          </>
        )}
        {outcome?.status === "invalid" && (
          <>
            <h1 className="text-[1.2rem] font-semibold text-slate-900">That link didn&apos;t work</h1>
            <p className="mt-2 text-[0.9rem] text-slate-600">{outcome.message}</p>
            <Link href="/dashboard/settings" className="mt-4 inline-flex rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700">
              Try again from settings
            </Link>
          </>
        )}
      </div>
    </div>
  );
}

export default function ConfirmEmailPage() {
  return (
    <Suspense fallback={<div className={shell}><div className={card}>Loading…</div></div>}>
      <ConfirmEmailChange />
    </Suspense>
  );
}
