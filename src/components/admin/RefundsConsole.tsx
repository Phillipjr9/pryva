"use client";

import { useCallback, useEffect, useState } from "react";

type RefundOrder = {
  id: string;
  reference: string;
  productName: string;
  amount: number;
  status: string;
  refundedAt: string | null;
  createdAt: string | null;
};

const FILTERS = [
  { value: "pending", label: "Needs a refund" },
  { value: "processed", label: "Refunded" },
  { value: "all", label: "All" },
] as const;

function naira(value: number): string {
  return `₦${Math.round(value).toLocaleString("en-NG")}`;
}

function when(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("en-NG");
}

export function RefundsConsole() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("pending");
  const [rows, setRows] = useState<RefundOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  // Per-order action state, keyed by order id so two rows cannot share a prompt.
  const [acting, setActing] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  /**
   * Pure fetch: no state is touched here. Setting state synchronously inside an
   * effect body cascades a second render, so the effect awaits this and applies
   * the result afterwards, and changing the filter marks the list stale itself.
   */
  const fetchRows = useCallback(
    async (status: string): Promise<{ rows: RefundOrder[]; error: string | null }> => {
      try {
        const response = await fetch(`/api/admin/refunds?status=${encodeURIComponent(status)}`, {
          headers: { accept: "application/json" },
        });
        const data = (await response.json()) as { ok?: boolean; orders?: RefundOrder[]; error?: string };
        if (!response.ok || !data.ok) {
          return { rows: [], error: data.error ?? "Could not load refunds." };
        }
        return { rows: data.orders ?? [], error: null };
      } catch {
        return { rows: [], error: "Could not reach the server." };
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchRows(filter);
      // A filter changed while this was in flight; its answer is stale.
      if (cancelled) return;
      setRows(result.rows);
      setListError(result.error);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [filter, fetchRows]);

  async function refund(order: RefundOrder) {
    // An order in review is one whose provider outcome was never verified. The
    // endpoint will only refund it when the admin confirms reconciliation and
    // gives a reason, because the unit may still be live upstream.
    const needsConfirmation = order.status === "review";
    const reason = (reasons[order.id] ?? "").trim();
    if (needsConfirmation && (!confirmed[order.id] || !reason)) {
      setActionError("Confirm reconciliation and give a reason before refunding this order.");
      return;
    }

    setActing(order.id);
    setActionError(null);
    try {
      const response = await fetch("/api/admin/refunds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          ...(reason ? { reason } : {}),
          ...(needsConfirmation ? { reconciliationConfirmed: true } : {}),
        }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setActionError(data.error ?? "The refund did not go through.");
        return;
      }
      setReasons((prev) => ({ ...prev, [order.id]: "" }));
      setConfirmed((prev) => ({ ...prev, [order.id]: false }));
      const refreshed = await fetchRows(filter);
      setRows(refreshed.rows);
      setListError(refreshed.error);
    } catch {
      setActionError("Could not reach the server.");
    } finally {
      setActing(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-full border border-line bg-white/70 p-1">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              setFilter(option.value);
              setLoading(true);
            }}
            className={`rounded-full px-3 py-1.5 text-meta font-semibold transition-colors sm:px-4 sm:py-2 ${
              filter === option.value ? "bg-ink text-white" : "text-ink-2 hover:bg-lav-50"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {actionError && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
          {actionError}
        </p>
      )}
      {listError && (
        <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800">
          {listError}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-ink-2">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-line bg-white/70 p-5 text-sm text-ink-2">
          Nothing here right now.
        </p>
      ) : (
        <div className="space-y-3">
          {rows.map((order) => {
            const needsConfirmation = order.status === "review";
            const refunded = Boolean(order.refundedAt);
            return (
              <div key={order.id} className="rounded-xl border border-line bg-white/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-ink">{order.productName}</p>
                    <p className="mt-0.5 text-meta text-ink-3">
                      {order.reference} · <span className="uppercase">{order.status}</span> ·{" "}
                      {when(order.createdAt)}
                    </p>
                  </div>
                  <p className="font-semibold tabular-nums text-ink">{naira(order.amount)}</p>
                </div>

                {refunded ? (
                  <p className="mt-3 text-meta text-emerald-700">
                    Refunded {when(order.refundedAt)}
                  </p>
                ) : (
                  <div className="mt-3 space-y-2.5">
                    {needsConfirmation && (
                      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-meta text-amber-900">
                        This order is under review, so its provider outcome was never verified. The
                        unit may still be live. Confirm you have reconciled it and say why.
                      </p>
                    )}
                    <input
                      type="text"
                      maxLength={180}
                      value={reasons[order.id] ?? ""}
                      onChange={(event) =>
                        setReasons((prev) => ({ ...prev, [order.id]: event.target.value }))
                      }
                      placeholder={needsConfirmation ? "Reason (required)" : "Reason (optional)"}
                      className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-lav-400"
                    />
                    {needsConfirmation && (
                      <label className="flex items-start gap-2 text-meta text-ink-2">
                        <input
                          type="checkbox"
                          checked={confirmed[order.id] ?? false}
                          onChange={(event) =>
                            setConfirmed((prev) => ({ ...prev, [order.id]: event.target.checked }))
                          }
                          className="mt-0.5"
                        />
                        I have reconciled this order and accept that the unit may not be recovered.
                      </label>
                    )}
                    <button
                      type="button"
                      onClick={() => void refund(order)}
                      disabled={acting === order.id}
                      className="rounded-lg bg-lav-600 px-3.5 py-2 text-[0.8rem] font-semibold text-white transition-colors hover:bg-lav-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {acting === order.id ? "Refunding…" : `Refund ${naira(order.amount)}`}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
