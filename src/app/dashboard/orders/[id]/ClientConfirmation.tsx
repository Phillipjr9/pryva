"use client";
import { useState } from "react";

/** Codes stay in component memory only, and are erased before the POST. */
export function ClientConfirmation({ orderId }: { orderId: string }) {
  const [busy, setBusy] = useState(false), [required, setRequired] = useState(false);
  const [code, setCode] = useState(""), [message, setMessage] = useState<string | null>(null);
  async function check() {
    setBusy(true); setMessage(null); setRequired(false); setCode("");
    try {
      const response = await fetch(`/api/digital/client-confirmation?id=${encodeURIComponent(orderId)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) setMessage(data.error ?? "Could not check confirmation.");
      else if (data.required) setRequired(true);
      else setMessage(data.blocked ? "A code was already submitted or its outcome is uncertain. Check delivery or contact support." : "No confirmation code is requested for this order right now.");
    } catch { setMessage("Could not check confirmation. Try again later."); }
    finally { setBusy(false); }
  }
  async function submit() {
    const value = code.trim();
    if (!/^[A-Za-z0-9 ._-]{1,255}$/.test(value)) { setMessage("Enter the confirmation code you received."); return; }
    setBusy(true); setMessage(null); setCode(""); setRequired(false);
    try {
      const response = await fetch("/api/digital/client-confirmation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderId, code: value }) });
      const data = await response.json();
      setMessage(data.message ?? data.error ?? "Could not confirm the result. Contact support.");
      if (!response.ok && response.status === 400) setRequired(true);
    } catch { setMessage("The result is unknown. Contact support before submitting another code."); }
    finally { setBusy(false); }
  }
  return <div className="mt-3 space-y-2">
    {!required && <button type="button" disabled={busy} onClick={() => void check()} className="rounded-lg border border-line px-3 py-2 text-meta font-semibold text-lav-700 disabled:opacity-50">Check if a confirmation code is needed</button>}
    {required && <div className="space-y-2"><p className="text-meta text-ink-2">This order requires the confirmation code sent to your account. Never enter your password here.</p><label htmlFor="account-confirmation" className="block text-meta font-semibold">Confirmation code</label><input id="account-confirmation" type="text" autoComplete="one-time-code" maxLength={255} value={code} onChange={(event) => setCode(event.target.value)} className="w-full rounded-xl border border-line px-3 py-2" /><button type="button" disabled={busy || !code.trim()} onClick={() => void submit()} className="rounded-xl bg-lav-700 px-4 py-2 font-semibold text-white disabled:opacity-50">Submit confirmation code</button></div>}
    {message && <p role="status" className="text-meta text-ink-2">{message}</p>}
  </div>;
}
