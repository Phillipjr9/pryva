"use client";

import { useState } from "react";

/**
 * Changing the sign-in address.
 *
 * The form deliberately does not change anything: it asks the server to send a
 * link to the new address, and the change only happens when that link is opened.
 * The copy says so, because otherwise a customer types a new address, sees
 * "sent", and assumes the change already applied.
 */
export function EmailChangeCard({ currentEmail }: { currentEmail: string }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setFailed(false);
    try {
      const response = await fetch("/api/user/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
      if (response.ok) {
        setMessage(data.message ?? "Check the new address for a link to confirm it.");
        setEmail("");
      } else {
        setFailed(true);
        setMessage(data.error ?? "We couldn't start that change. Try again.");
      }
    } catch {
      setFailed(true);
      setMessage("We couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <h2 className="text-[1rem] font-semibold text-ink">Sign-in email</h2>
      <p className="mt-1 text-[0.88rem] text-ink-2">
        You sign in with <strong className="text-ink">{currentEmail}</strong>. A new address only takes over once you
        open the link we send to it.
      </p>
      <form onSubmit={submit} className="mt-3 flex flex-wrap gap-2">
        <label htmlFor="new-email" className="sr-only">New email address</label>
        <input
          id="new-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="new@example.com"
          className="min-w-0 flex-1 rounded-xl border border-line bg-white px-3 py-2 text-[0.9rem] text-ink outline-none focus:border-lav-400"
        />
        <button
          type="submit"
          disabled={busy || email.trim().length === 0}
          className="rounded-xl bg-lav-600 px-4 py-2 text-[0.85rem] font-semibold text-white hover:bg-lav-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Sending…" : "Send confirmation"}
        </button>
      </form>
      {message && (
        <p role="status" aria-live="polite" className={`mt-2 text-[0.82rem] ${failed ? "text-rose-600" : "text-emerald-700"}`}>
          {message}
        </p>
      )}
    </section>
  );
}
