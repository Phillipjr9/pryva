"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  orderId: string;
  reference: string;
  quantity: number;
  status: string;
};

/**
 * Deliver or cancel one hand-sourced order.
 *
 * Credentials are typed one per line and sent once. The button disables while
 * the request is in flight so a double click cannot deliver twice, and a
 * successful delivery refreshes the queue.
 */
export function FulfilmentControl({ orderId, reference, quantity, status }: Props) {
  const router = useRouter();
  const [credentials, setCredentials] = useState("");
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"deliver" | "unavailable" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const lines = credentials.split("\n").map((line) => line.trim()).filter(Boolean);
  const ready = mode === "unavailable" ? reason.trim().length > 0 : lines.length === quantity;

  async function submit() {
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const response = await fetch("/api/admin/fulfilment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          mode === "unavailable"
            ? { orderId, action: "unavailable", reason: reason.trim() }
            : { orderId, action: "deliver", credentials: lines },
        ),
      });
      const data = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; status?: string; nextStep?: string }
        | null;
      if (!response.ok || !data?.ok) {
        setError(data?.error ?? "That did not go through. Check the order and try again.");
        return;
      }
      setCredentials("");
      setReason("");
      setMode(null);
      setDone(
        data.status === "delivered"
          ? `Delivered ${quantity} credential${quantity === 1 ? "" : "s"} for ${reference}.`
          : `Marked for review. ${data.nextStep ?? ""}`.trim(),
      );
      router.refresh();
    } catch {
      setError("Network problem. The order was not changed — check it before retrying.");
    } finally {
      setBusy(false);
    }
  }

  if (status !== "processing") {
    return (
      <p className="text-[0.8rem] text-ink-3">
        Waiting on a refund decision. Use the orders page to refund it with a reconciliation reason.
      </p>
    );
  }

  return (
    <div className="min-w-0 space-y-3">
      {done && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[0.8rem] text-emerald-800">{done}</p>}
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[0.8rem] text-rose-800">{error}</p>}

      {mode === null && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setMode("deliver")}
            className="rounded-lg bg-lav-700 px-3 py-1.5 text-[0.82rem] font-semibold text-white hover:bg-lav-800"
          >
            Add credentials
          </button>
          <button
            type="button"
            onClick={() => setMode("unavailable")}
            className="rounded-lg border border-line px-3 py-1.5 text-[0.82rem] font-medium text-ink-2 hover:border-rose-300 hover:text-rose-700"
          >
            Cannot source
          </button>
        </div>
      )}

      {mode === "deliver" && (
        <div className="min-w-0 space-y-2">
          <label className="block text-meta font-medium text-ink-2" htmlFor={`creds-${orderId}`}>
            One credential per line — exactly {quantity} needed ({lines.length} entered)
          </label>
          <textarea
            id={`creds-${orderId}`}
            value={credentials}
            onChange={(event) => setCredentials(event.target.value)}
            rows={Math.min(8, Math.max(3, quantity + 1))}
            spellCheck={false}
            autoComplete="off"
            className="w-full min-w-0 rounded-xl border border-line bg-white px-3 py-2 font-mono text-meta text-ink"
            placeholder="login|password|recovery"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !ready}
              onClick={() => void submit()}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[0.82rem] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? "Delivering…" : `Deliver ${quantity}`}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => { setMode(null); setError(null); }}
              className="rounded-lg border border-line px-3 py-1.5 text-[0.82rem] font-medium text-ink-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "unavailable" && (
        <div className="min-w-0 space-y-2">
          <label className="block text-meta font-medium text-ink-2" htmlFor={`reason-${orderId}`}>
            Why it could not be sourced (shown on the refund record)
          </label>
          <input
            id={`reason-${orderId}`}
            value={reason}
            onChange={(event) => setReason(event.target.value.slice(0, 180))}
            className="w-full min-w-0 rounded-xl border border-line bg-white px-3 py-2 text-[0.82rem] text-ink"
            placeholder="Out of stock, customer refunded"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || !ready}
              onClick={() => void submit()}
              className="rounded-lg bg-rose-600 px-3 py-1.5 text-[0.82rem] font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {busy ? "Updating…" : "Move to review"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => { setMode(null); setError(null); }}
              className="rounded-lg border border-line px-3 py-1.5 text-[0.82rem] font-medium text-ink-2"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
