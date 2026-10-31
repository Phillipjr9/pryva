"use client";

import { useEffect, useState } from "react";

import { AlertCircle, Check, Loader2, Shield } from "@/components/icons";
import type { FraudQueueRow } from "@/lib/fraud";

const KIND_LABEL: Record<string, string> = {
  withdrawal_review: "Withdrawal flagged",
  withdrawal_velocity: "Withdrawal velocity",
  referral_same_network: "Referral from the same network",
  purchase_velocity: "Too many purchases",
  gift_card_velocity: "Too many gift cards",
};

const SEVERITY_STYLE: Record<string, string> = {
  high: "border-red-200 bg-red-50 text-red-700",
  warn: "border-amber-200 bg-amber-50 text-amber-800",
  info: "border-slate-200 bg-slate-50 text-slate-600",
};

function formatNaira(amount: number) {
  return `₦${amount.toLocaleString("en-NG")}`;
}

/**
 * The fraud queue.
 *
 * Every row is something the platform noticed and a person has to judge. Nothing
 * here acts on its own: marking a row reviewed records the decision and empties
 * the queue; the money or the order was never touched by the detector.
 *
 * If a reason is wrong, the bug is upstream in the fact it came from (an account
 * age, a payout history), not in this screen — fix the fact.
 */
export function FraudQueue() {
  const [events, setEvents] = useState<FraudQueueRow[]>([]);
  const [openOnly, setOpenOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/security/fraud${openOnly ? "?open=1" : ""}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => ({
        ok: response.ok,
        body: (await response.json().catch(() => ({}))) as { ok?: boolean; events?: FraudQueueRow[]; error?: string },
      }))
      .then(({ ok, body }) => {
        if (controller.signal.aborted) return;
        if (!ok || !body.ok) {
          setError(body.error ?? "Could not read the fraud queue.");
          return;
        }
        setEvents(body.events ?? []);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (controller.signal.aborted) return;
        if ((loadError as Error)?.name === "AbortError") return;
        setError("Network hiccup. Please try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [openOnly]);

  async function review(id: string) {
    setPending(id);
    setError(null);
    try {
      const response = await fetch("/api/admin/security/fraud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const body = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) {
        setError(body.error ?? "Could not mark that event reviewed.");
        return;
      }
      setEvents((current) => current.filter((event) => event.id !== id));
    } catch {
      setError("Network hiccup. Please try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[1rem] font-semibold text-ink">
            <Shield className="h-4 w-4 text-lav-700" /> Fraud signals
          </h2>
          <p className="mt-1 max-w-2xl text-[0.84rem] leading-relaxed text-ink-2">
            Risk assessments and velocity ceilings. Advisory only — no automated action reads this queue,
            and nothing here moves money. Mark a row reviewed once you have judged it.
          </p>
        </div>
        <label className="flex items-center gap-2 text-[0.8rem] text-ink-2">
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(event) => {
              setLoading(true);
              setOpenOnly(event.target.checked);
            }}
            className="h-3.5 w-3.5 rounded border-line"
          />
          Unreviewed only
        </label>
      </div>

      {error ? (
        <p role="alert" className="mt-3 flex items-start gap-1.5 text-[0.82rem] font-medium text-rose-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-4 flex items-center gap-2 text-[0.84rem] text-ink-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading the queue…
        </p>
      ) : events.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-line bg-cream/40 px-3 py-3 text-[0.84rem] text-ink-3">
          {openOnly ? "Nothing waiting. Every signal has been reviewed." : "No signals have been recorded."}
        </p>
      ) : (
        <ul className="mt-4 grid gap-2">
          {events.map((event) => (
            <li key={event.id} className="rounded-xl border border-line bg-[#fffdfa] px-3 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[0.86rem] font-semibold text-ink">
                    {KIND_LABEL[event.kind] ?? event.kind}
                    <span
                      className={`rounded-full border px-2 py-0.5 text-micro font-medium ${
                        SEVERITY_STYLE[event.severity] ?? SEVERITY_STYLE.info
                      }`}
                    >
                      {event.severity}
                    </span>
                    {event.reviewedAt ? (
                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-micro font-medium text-emerald-700">
                        reviewed
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-[0.8rem] text-ink-2">{event.reasons}</p>
                  <p className="mt-1 text-micro text-ink-3">
                    {event.userEmail ?? "account deleted"}
                    {event.amount ? ` · ${formatNaira(event.amount)}` : ""}
                    {event.reference ? ` · ${event.reference}` : ""} ·{" "}
                    {new Date(event.createdAt).toLocaleString("en-NG", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                {!event.reviewedAt ? (
                  <button
                    type="button"
                    onClick={() => void review(event.id)}
                    disabled={pending === event.id}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[0.8rem] font-medium text-ink-2 hover:bg-lav-50 disabled:opacity-50"
                  >
                    {pending === event.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    Mark reviewed
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
