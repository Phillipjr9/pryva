"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function StarsOrderSync({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  return <div className="mt-3 space-y-2">
    <button type="button" disabled={busy} onClick={async () => {
      setBusy(true); setMessage(null);
      try {
        const response = await fetch(`/api/digital/telegram-stars/sync?id=${encodeURIComponent(orderId)}`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !result.ok) setMessage(result.error ?? "Could not check delivery.");
        else { setMessage(result.order?.status === "delivered" ? "Delivery confirmed." : "Delivery is not yet confirmed. Do not place the order again."); router.refresh(); }
      } catch { setMessage("Could not check delivery. Try again later."); }
      finally { setBusy(false); }
    }} className="rounded-lg border border-line px-3 py-2 text-meta font-semibold text-lav-700 disabled:opacity-50">Check delivery status</button>
    {message && <p role="status" className="text-meta text-ink-2">{message}</p>}
  </div>;
}
