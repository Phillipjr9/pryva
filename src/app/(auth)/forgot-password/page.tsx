"use client";

import { useState } from "react";
import Link from "next/link";

const field =
  "w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-lav-400";
const submitClass =
  "w-full rounded-xl bg-lav-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-lav-700 disabled:cursor-not-allowed disabled:opacity-60";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<{ busy: boolean; message: string | null; error: string | null }>({
    busy: false,
    message: null,
    error: null,
  });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState({ busy: true, message: null, error: null });
    try {
      const response = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await response.json()) as { ok?: boolean; message?: string; error?: string };
      if (!response.ok || !data.ok) {
        setState({ busy: false, message: null, error: data.error ?? "Something went wrong." });
        return;
      }
      // Shown for every address, so this confirms nothing about whether the
      // account exists.
      setState({ busy: false, message: data.message ?? "If that email has an account, a reset link is on its way.", error: null });
    } catch {
      setState({ busy: false, message: null, error: "Could not reach the server. Try again." });
    }
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-16">
      <h1 className="text-2xl font-semibold text-ink">Reset your password</h1>
      <p className="mt-2 text-sm text-ink-2">
        Enter the email on your account and we will send a link to choose a new password.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-ink-3">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={field}
            placeholder="you@example.com"
          />
        </div>

        {state.error && (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            {state.error}
          </p>
        )}
        {state.message && (
          <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800">
            {state.message}
          </p>
        )}

        <button type="submit" disabled={state.busy || !email.trim()} className={submitClass}>
          {state.busy ? "Sending…" : "Send reset link"}
        </button>
      </form>

      <p className="mt-5 text-sm text-ink-2">
        Remembered it?{" "}
        <Link href="/login" className="font-semibold text-lav-700 underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </div>
  );
}
