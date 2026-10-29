"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

const field =
  "w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-sm text-ink outline-none transition-colors focus:border-lav-400";
const submitClass =
  "w-full rounded-xl bg-lav-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-lav-700 disabled:cursor-not-allowed disabled:opacity-60";

function ResetForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });

  // Derived, not stored: the token comes from the URL, so an effect would only
  // duplicate render work and cascade a second render.
  const shownError = token ? state.error : "This link is missing its token. Request a new one.";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setState({ busy: false, error: "The two passwords do not match." });
      return;
    }
    setState({ busy: true, error: null });
    try {
      const response = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setState({ busy: false, error: data.error ?? "Something went wrong." });
        return;
      }
      router.push("/login?reset=1");
    } catch {
      setState({ busy: false, error: "Could not reach the server. Try again." });
    }
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-16">
      <h1 className="text-2xl font-semibold text-ink">Choose a new password</h1>
      <p className="mt-2 text-sm text-ink-2">
        Signing in again everywhere else will be required — resetting your password signs out every
        other device.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="password" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-ink-3">
            New password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={field}
          />
        </div>
        <div>
          <label htmlFor="confirm" className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-ink-3">
            Confirm password
          </label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            maxLength={128}
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            className={field}
          />
        </div>

        {shownError && (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
            {shownError}
          </p>
        )}

        <button type="submit" disabled={state.busy || !token || !password || !confirm} className={submitClass}>
          {state.busy ? "Saving…" : "Save new password"}
        </button>
      </form>

      <p className="mt-5 text-sm text-ink-2">
        Link expired?{" "}
        <Link href="/forgot-password" className="font-semibold text-lav-700 underline underline-offset-2">
          Request a new one
        </Link>
      </p>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetForm />
    </Suspense>
  );
}
