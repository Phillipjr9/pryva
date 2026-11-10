"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, Shield } from "@/components/icons";

export function BanAccountButton({ userId, email, suspended }: {
  userId: string;
  email: string;
  name: string;
  suspended: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function update() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/users/${userId}/ban`, {
        method: suspended ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      const data = await response.json().catch(() => ({})) as { ok?: boolean; message?: string; error?: string };
      if (!response.ok || !data.ok) setMessage(data.error ?? "Could not update the account.");
      else { setMessage(data.message ?? "Account updated."); setOpen(false); router.refresh(); }
    } catch {
      setMessage("The result is uncertain. Reload this page to check the account status before trying again.");
    } finally { setBusy(false); }
  }

  return (
    <section id="ban-account" className="rounded-[1.5rem] border border-rose-200 bg-rose-50/30 p-5">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="h-5 w-5 text-rose-700" />
        <div>
          <h2 className="text-[0.9375rem] font-semibold text-ink">{suspended ? "Account suspended" : "Suspend account"}</h2>
          <p className="mt-1 text-meta text-ink-2">
            {suspended ? "Sign-in is disabled. Reinstatement does not restart paused schedules." :
              `Suspension immediately revokes sessions and pauses active schedules for ${email}. Account identity, orders and financial records are retained. A notice to a verified email is best effort.`}
          </p>
        </div>
      </div>
      {message && <p role="status" className="mt-3 text-meta text-ink-2">{message}</p>}
      {!open ? <button type="button" className="btn mt-3 border border-rose-300 bg-white" onClick={() => setOpen(true)}>{suspended ? "Reinstate account" : "Suspend account"}</button> : (
        <div className="mt-4 grid gap-3">
          <label className="grid gap-1 text-meta">Reason (optional)
            <input className="field" value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} disabled={busy} />
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn bg-rose-700 text-white" disabled={busy} onClick={() => void update()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
              {suspended ? "Confirm reinstatement" : "Confirm suspension"}
            </button>
            <button type="button" className="btn border border-line bg-white" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </section>
  );
}
