"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatNaira } from "@/lib/catalog";

export interface ScheduledRow {
  id: string;
  status: string;
  frequency: string;
  productName: string;
  planLabel: string;
  price: number | null;
  nextRunLabel: string;
  due: boolean;
  lastRunLabel: string | null;
  lastOrderId: string | null;
}

export interface CreatablePlan {
  slug: string;
  service: string;
  name: string;
  planLabel: string;
  price: number;
}

const FREQUENCIES = [
  { value: "daily", label: "Every night" },
  { value: "weekly", label: "Every week" },
  { value: "biweekly", label: "Every two weeks" },
  { value: "monthly", label: "Every month" },
] as const;

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  cancelled: "Cancelled",
};

/**
 * Create, pause, resume and cancel a recurring purchase.
 *
 * Every option here is one the runner can honour: it wakes once a night, so the
 * shortest honest interval is "every night". A true "every hour" cadence would
 * need a second job, which the Hobby plan's two cron entries do not have room for.
 */
export function ScheduledManager({
  rows,
  creatable,
  balance,
}: {
  rows: ScheduledRow[];
  creatable: CreatablePlan[];
  balance: number;
}) {
  const router = useRouter();
  const [planSlug, setPlanSlug] = useState(creatable[0]?.slug ?? "");
  const [frequency, setFrequency] = useState<string>("weekly");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selected = creatable.find((plan) => plan.slug === planSlug) ?? null;
  const shortOfFunds = selected ? balance < selected.price : false;

  async function create() {
    if (!selected || creating) return;
    setCreating(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/scheduled-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service: selected.service, productSlug: selected.slug, frequency }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Could not create the schedule.");
        return;
      }
      setMessage(`Scheduled. The first run is on ${new Date(data.nextRunAt).toLocaleDateString("en-NG", { day: "numeric", month: "short" })}.`);
      router.refresh();
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  async function act(id: string, action: "pause" | "resume" | "cancel") {
    setBusyId(id);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/scheduled-orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: id, action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "That change could not be made.");
        return;
      }
      router.refresh();
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-[0.86rem] text-red-800">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-[0.86rem] text-emerald-900">
          {message}
        </div>
      )}

      {creatable.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-[0.86rem] leading-relaxed text-amber-900">
          No plan can be delivered automatically right now, so nothing can be scheduled. This page
          cannot place an order on its own.
        </div>
      ) : (
        <div className="rounded-xl border border-line bg-white p-6">
          <h2 className="text-[1rem] font-semibold text-ink">New schedule</h2>
          <p className="mt-1 text-[0.82rem] leading-relaxed text-ink-2">
            Runs once a night. Nothing is charged unless the plan is delivered, so a night where
            your balance is short or the service cannot deliver costs you nothing — the schedule
            stays due and we try again the next night.
          </p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[0.82rem] font-medium text-ink">Plan</span>
              <select
                value={planSlug}
                onChange={(event) => setPlanSlug(event.target.value)}
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[0.86rem] text-ink"
              >
                {creatable.map((plan) => (
                  <option key={plan.slug} value={plan.slug}>
                    {plan.name} — {plan.planLabel} — {formatNaira(plan.price)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[0.82rem] font-medium text-ink">How often</span>
              <select
                value={frequency}
                onChange={(event) => setFrequency(event.target.value)}
                className="w-full rounded-lg border border-line bg-white px-3 py-2 text-[0.86rem] text-ink"
              >
                {FREQUENCIES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="mt-3 text-[0.82rem] text-ink-2">
            Wallet balance: <span className="font-semibold text-ink">{formatNaira(balance)}</span>
            {selected && ` · each run charges ${formatNaira(selected.price)}`}
            {shortOfFunds && " · your balance is below one run, so top up before the next attempt"}
          </p>

          <button
            type="button"
            onClick={create}
            disabled={creating || !selected}
            className="btn btn-primary mt-4 disabled:opacity-60"
          >
            {creating ? "Scheduling…" : "Schedule this purchase"}
          </button>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-[1rem] font-semibold text-ink">Your schedules</h2>
        {rows.length === 0 ? (
          <p className="rounded-xl border border-line bg-white p-6 text-[0.86rem] text-ink-2">
            You have no schedules yet.
          </p>
        ) : (
          rows.map((row) => (
            <div key={row.id} className="rounded-xl border border-line bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[0.92rem] font-semibold text-ink">{row.productName}</p>
                  <p className="text-[0.82rem] text-ink-2">
                    {row.planLabel}
                    {row.price !== null && ` · ${formatNaira(row.price)} per run`}
                    {" · "}
                    {FREQUENCIES.find((f) => f.value === row.frequency)?.label.toLowerCase() ??
                      `every ${row.frequency}`}
                  </p>
                </div>
                <span className="rounded-full border border-line px-3 py-1 text-[0.8rem] font-semibold text-ink-2">
                  {STATUS_LABELS[row.status] ?? row.status}
                </span>
              </div>

              <p className="mt-3 text-[0.82rem] text-ink-2">
                {row.status === "cancelled"
                  ? "Cancelled. Nothing further will run."
                  : row.due
                    ? "Due now — the last attempt did not go through (balance or availability). We will try again tonight."
                    : `Next attempt: ${row.nextRunLabel}`}
                {row.lastRunLabel && ` · last run ${row.lastRunLabel}`}
                {row.lastOrderId && (
                  <>
                    {" · "}
                    <Link href={`/dashboard/orders/${row.lastOrderId}`} className="font-semibold text-lav-700 hover:underline">
                      View the order
                    </Link>
                  </>
                )}
              </p>

              {row.status !== "cancelled" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {row.status === "active" ? (
                    <button
                      type="button"
                      aria-label={`Pause ${row.productName}`}
                      onClick={() => act(row.id, "pause")}
                      disabled={busyId === row.id}
                      className="btn btn-ghost disabled:opacity-60"
                    >
                      Pause
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Resume ${row.productName}`}
                      onClick={() => act(row.id, "resume")}
                      disabled={busyId === row.id}
                      className="btn btn-primary disabled:opacity-60"
                    >
                      Resume
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`Cancel ${row.productName}`}
                    onClick={() => act(row.id, "cancel")}
                    disabled={busyId === row.id}
                    className="btn btn-ghost disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
