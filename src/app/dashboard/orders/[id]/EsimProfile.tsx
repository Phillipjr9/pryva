"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Check, Refresh } from "@/components/icons";

/**
 * The activation material for an eSIM order.
 *
 * The activation code is a bearer credential: whoever holds it can install the
 * plan. It is therefore shown here and nowhere else — not in the order list, not
 * in an email — and the copy action is the only way it leaves the page.
 */
export function EsimProfile({
  orderId,
  activationCode,
  installUrl,
  iccid,
  pending,
}: {
  orderId: string;
  activationCode: string | null;
  installUrl: string | null;
  iccid: string | null;
  pending: boolean;
}) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function copy() {
    if (!activationCode) return;
    try {
      await navigator.clipboard.writeText(activationCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_500);
    } catch {
      setMessage("Select the code and copy it manually.");
    }
  }

  async function checkDelivery() {
    setChecking(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/esim/orders/${encodeURIComponent(orderId)}/complete`, { method: "POST" });
      const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; delivered?: boolean; message?: string; error?: string };
      if (payload.delivered) {
        router.refresh();
        return;
      }
      setMessage(payload.message ?? payload.error ?? "Still provisioning. Try again in a moment.");
    } catch {
      setMessage("We couldn't reach the server. Try again in a moment.");
    } finally {
      setChecking(false);
    }
  }

  if (pending) {
    return (
      <div className="grid gap-3">
        <p className="text-[0.92rem] leading-relaxed text-ink-2">
          Your eSIM is being provisioned. Nothing has been charged yet — the charge is made when the
          profile arrives, and its activation code appears here.
        </p>
        <button
          type="button"
          onClick={checkDelivery}
          disabled={checking}
          className="inline-flex w-fit items-center gap-2 rounded-xl border border-line bg-white px-4 py-2 text-meta font-semibold text-ink hover:border-lav-300 disabled:opacity-60"
        >
          <Refresh className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} aria-hidden="true" />
          {checking ? "Checking…" : "Check delivery"}
        </button>
        {message ? <p className="text-meta text-ink-2">{message}</p> : null}
      </div>
    );
  }

  if (!activationCode) {
    return (
      <p className="text-[0.92rem] text-ink-2">
        This order has no activation code on file. Contact support with the reference above and we will recover it for
        you.
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      <div>
        <p className="text-micro font-semibold uppercase tracking-[0.14em] text-ink-3">Activation code</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-xl border border-line bg-cream/60 px-3 py-2 font-mono text-[0.8rem] text-ink">
            {activationCode}
          </code>
          <button
            type="button"
            onClick={copy}
            className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2 text-meta font-semibold text-ink hover:border-lav-300"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" /> : null}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <ol className="grid list-decimal gap-1.5 pl-5 text-[0.9rem] leading-relaxed text-ink-2">
        <li>Open Settings → Mobile data on the device and choose “Add eSIM”.</li>
        <li>Pick “Enter details manually” and paste the code above.</li>
        <li>Label the line eSIM and turn on data roaming while you travel.</li>
      </ol>

      {installUrl ? (
        <a
          href={installUrl}
          rel="noreferrer noopener"
          className="inline-flex w-fit items-center gap-2 rounded-xl bg-lav-600 px-4 py-2.5 text-meta font-semibold text-white hover:bg-lav-700"
        >
          One-tap install
        </a>
      ) : null}

      {iccid ? <p className="text-micro text-ink-3">ICCID {iccid}</p> : null}
      {message ? <p className="text-meta text-ink-2">{message}</p> : null}
      <p className="text-micro text-ink-3">
        Anyone with this code can install the plan. Keep it to yourself and don&apos;t share screenshots of this page.
      </p>
    </div>
  );
}
