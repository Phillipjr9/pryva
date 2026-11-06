"use client";

import { useState } from "react";

import { AlertTriangle, CheckCircle, Loader2, Mail, Shield, Trash2, XCircle } from "@/components/icons";

type BanState = "idle" | "pending" | "done" | "error";

type Failure = {
  error?: string;
};

export function BanAccountButton({
  userId,
  email,
  name,
}: {
  userId: string;
  email: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<BanState>("idle");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);

  function cancel() {
    setOpen(false);
    setReason("");
    setError(null);
  }

  async function requestBan() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/users/${userId}/ban`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      const data = (await response.json().catch(() => ({}))) as Failure & { ok?: boolean };
      if (!response.ok || !data.ok) {
        setError(data);
        return;
      }
      setState("done");
    } catch {
      setError({
        error: "The connection dropped, so we couldn't confirm whether the ban was requested. Try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  if (state === "done") {
    return (
      <section id="account-banned" className="rounded-[1.5rem] border border-emerald-200 bg-emerald-50/50 p-5" aria-live="polite">
        <div className="flex items-start gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
            <CheckCircle className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className="text-[0.95rem] font-semibold text-emerald-900">Closure requested</h2>
            <p className="mt-1 text-meta leading-relaxed text-emerald-900/80">
              A confirmation link has been emailed to <strong>{email}</strong>. The account will close when that link is clicked.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section id="ban-account" className="rounded-[1.5rem] border border-rose-200 bg-rose-50/30 p-5">
      <div className="flex items-start gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-rose-100 text-rose-700">
          <AlertTriangle className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-[0.95rem] font-semibold text-ink">Ban / close account</h2>
          <p className="mt-0.5 text-meta leading-relaxed text-ink-2">
            Request that this account be closed. A confirmation link is emailed to {email}; the account closes when the link is
            clicked. Orders, wallet history and security records are retained — the sign-in identity is removed.
          </p>
        </div>
      </div>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          disabled={busy}
          className={`btn mt-3.5 w-fit border border-rose-300 bg-white !px-4 !py-2.5 !text-[0.8rem] text-rose-800 hover:border-rose-400 disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <Trash2 className="h-3.5 w-3.5" /> Ban this account
        </button>
      ) : (
        <div className="mt-4 grid gap-4">
          <div className="rounded-xl border border-line bg-white p-3.5">
            <p className="flex items-center gap-1.5 text-[0.82rem] font-semibold text-ink">
              <Shield className="h-3.5 w-3.5 text-rose-600" /> What happens
            </p>
            <ul className="mt-2 grid gap-1.5 text-meta text-ink-2">
              <li className="flex gap-1.5">
                <span aria-hidden="true" className="text-rose-500">·</span>
                A confirmation link is emailed to <strong>{email}</strong>
              </li>
              <li className="flex gap-1.5">
                <span aria-hidden="true" className="text-rose-500">·</span>
                The account closes only when the link is clicked
              </li>
              <li className="flex gap-1.5">
                <span aria-hidden="true" className="text-rose-500">·</span>
                Sign-in identity, credentials and devices are removed
              </li>
              <li className="flex gap-1.5">
                <span aria-hidden="true" className="text-rose-500">·</span>
                Orders, payments and fraud records are retained
              </li>
            </ul>
          </div>

          <div className="grid gap-3">
            <label className="grid gap-1.5 text-meta font-medium text-ink-2">
              Reason (optional)
              <input
                type="text"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="field w-full"
                placeholder="e.g. fraud, abuse, terms violation"
                disabled={busy}
              />
            </label>
          </div>

          {error ? (
            <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-meta text-rose-800">
              <p>{error.error ?? "The ban could not be requested. Please try again."}</p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void requestBan()}
              disabled={busy}
              className={`btn w-fit !px-4 !py-2.5 !text-[0.8rem] bg-rose-700 text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {busy ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Requesting…
                </>
              ) : (
                <>
                  <Mail className="h-3.5 w-3.5" /> Send confirmation email
                </>
              )}
            </button>
            <button
              type="button"
              onClick={cancel}
              disabled={busy}
              className="btn w-fit border border-line bg-white !px-4 !py-2.5 !text-[0.8rem] text-ink-2 hover:border-lav-300 disabled:opacity-50"
            >
              Keep account
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
