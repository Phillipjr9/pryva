"use client";

import { useState } from "react";

type Check = {
  ok: boolean;
  configured: boolean;
  reachable: boolean;
  currency: "NGN" | "USD" | null;
  balance: number | null;
  services: number;
  listed: number;
  markupPercent: number;
  fxRate: number | null;
  endpointHost: string | null;
  error: string | null;
  hint: string;
};

/**
 * The live half of the boosting check.
 *
 * Deliberately a button rather than something that runs on page load: every
 * press spends two outbound requests on a rate-limited key, and an admin screen
 * that quietly polls would burn through that quota while nobody is looking at it.
 */
export function BoostingLiveCheck() {
  const [state, setState] = useState<
    { status: "idle" } | { status: "running" } | { status: "done"; check: Check } | { status: "failed"; error: string }
  >({ status: "idle" });

  async function run() {
    setState({ status: "running" });
    try {
      const response = await fetch("/api/admin/boosting", { cache: "no-store" });
      const data = (await response.json()) as Check & { ok?: boolean; error?: string };
      if (!response.ok || data.ok === false) throw new Error(data.error || "The check could not run.");
      setState({ status: "done", check: data });
    } catch (caught) {
      setState({ status: "failed", error: caught instanceof Error ? caught.message : "The check could not run." });
    }
  }

  const check = state.status === "done" ? state.check : null;

  return (
    <section className="rounded-2xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-[1rem] font-semibold text-ink">Live check</h2>
          <p className="mt-1 text-meta text-ink-2">
            Asks the boosting service two read-only questions: what is my balance, and what do you sell. It cannot
            place, refill or cancel an order.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={state.status === "running"}
          className="btn btn-primary !px-4 !py-2.5 !text-[0.8rem] disabled:opacity-60"
        >
          {state.status === "running" ? "Asking…" : "Run live check"}
        </button>
      </div>

      {state.status === "failed" && (
        <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-meta text-rose-700">
          {state.error}
        </p>
      )}

      {check && (
        <div className="mt-4 grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Service answers" value={check.reachable ? "Yes" : "No"} tone={check.reachable ? "good" : "bad"} />
            <Fact label="Billing currency" value={check.currency ?? "Not reported"} tone={check.currency ? "good" : "bad"} />
            <Fact
              label="Service balance"
              value={check.balance === null ? "—" : `${check.balance.toLocaleString("en-NG")} ${check.currency ?? ""}`.trim()}
              tone={check.balance === null ? "muted" : "good"}
            />
            <Fact
              label="Listed for sale"
              value={`${check.listed} of ${check.services}`}
              tone={check.services === 0 || check.listed === 0 ? "bad" : "good"}
            />
          </div>

          {check.error && (
            <p className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-meta text-rose-700">{check.error}</p>
          )}

          <p className="rounded-xl border border-lav-200 bg-lav-50 px-3.5 py-2.5 text-meta leading-relaxed text-lav-800">
            {check.hint}
          </p>

          <p className="text-micro text-ink-3">
            Retail margin {check.markupPercent}% · naira rate{" "}
            {check.fxRate === null ? "not set (only needed when the panel bills in USD)" : `₦${check.fxRate.toLocaleString("en-NG")}/$1`} ·
            endpoint {check.endpointHost ?? "not set"}
          </p>
        </div>
      )}
    </section>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone: "good" | "bad" | "warn" | "muted" }) {
  const toneClass =
    tone === "good"
      ? "border-emerald-200 bg-emerald-50/70 text-emerald-900"
      : tone === "bad"
        ? "border-rose-200 bg-rose-50/70 text-rose-800"
        : tone === "warn"
          ? "border-amber-200 bg-amber-50/70 text-amber-900"
          : "border-line bg-cream text-ink-2";
  return (
    <div className={`rounded-xl border px-3.5 py-2.5 ${toneClass}`}>
      <p className="text-micro font-semibold uppercase tracking-[0.12em] opacity-70">{label}</p>
      <p className="mt-1 text-[0.95rem] font-medium">{value}</p>
    </div>
  );
}
