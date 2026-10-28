"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { PaymentLoading } from "@/components/ui/PaymentLoading";
import { PaymentSuccess } from "@/components/ui/PaymentSuccess";
import { plans, formatNaira, findPlan } from "@/lib/catalog";
import { Calendar, Pause, Play, X } from "@/components/icons";
import type { PublicUser } from "@/lib/auth";

interface ScheduledOrdersManagerProps {
  user: PublicUser;
  preview: boolean;
}

interface ScheduledOrder {
  id: string;
  service: string;
  productSlug: string;
  frequency: string;
  nextRunAt: string;
  lastRunAt: string | null;
  status: string;
  createdAt: string;
}

export function ScheduledOrdersManager({ user, preview }: ScheduledOrdersManagerProps) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);
  const runAttempt = useRef<{ scheduleId: string; requestId: string } | null>(null);
  const runInFlight = useRef(false);
  const [orders, setOrders] = useState<ScheduledOrder[]>([]);
  const [historyState, setHistoryState] = useState<"loading" | "ready" | "error">("loading");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<string>("");
  const [frequency, setFrequency] = useState<string>("monthly");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    fetchOrders();
  }, []);

  async function fetchOrders() {
    setHistoryState("loading");
    try {
      const response = await fetch("/api/scheduled-orders", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok || !Array.isArray(data.orders)) throw new Error("History unavailable");
      setOrders(data.orders);
      setHistoryState("ready");
    } catch {
      setHistoryState("error");
    }
  }

  async function handleCreate() {
    if (!preview) return;
    if (!selectedPlan || !frequency) {
      setError("Please select a plan and frequency");
      return;
    }

    setCreating(true);
    setError(null);
    setSuccess(null);

    try {
      const plan = findPlan(selectedPlan);
      if (!plan) throw new Error("Invalid plan");

      const response = await fetch("/api/scheduled-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service: plan.service,
          productSlug: selectedPlan,
          frequency,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Failed to create scheduled order");
      }

      setSuccess("Scheduled order created successfully");
      setSelectedPlan("");
      setFrequency("monthly");
      fetchOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create scheduled order");
    } finally {
      setCreating(false);
    }
  }

  async function handleAction(orderId: string, action: "pause" | "resume" | "cancel") {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/scheduled-orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, action }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Failed to update scheduled order");
      }

      fetchOrders();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update scheduled order");
    } finally {
      setLoading(false);
    }
  }

  async function runNow(scheduleId: string) {
    if (!preview || runInFlight.current) return;
    if (runAttempt.current && runAttempt.current.scheduleId !== scheduleId) {
      setError("Check your orders and retry the previous demo run before starting another.");
      return;
    }
    runInFlight.current = true;
    setRunning(true);
    setError(null);
    try {
      runAttempt.current ??= { scheduleId, requestId: crypto.randomUUID() };
      const [response] = await Promise.all([
        fetch(`/api/demo/schedules/${encodeURIComponent(scheduleId)}/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: runAttempt.current.requestId }) }),
        new Promise((resolve) => setTimeout(resolve, 1600)),
      ]);
      const data = await response.json() as { ok?: boolean; simulated?: boolean; orderId?: string; error?: string };
      if (!response.ok || !data.ok || !data.simulated || !data.orderId) {
        if (response.status >= 400 && response.status < 500 && response.status !== 409) runAttempt.current = null;
        setError(data.error ?? "Could not confirm the demo run. Check your orders before retrying."); return;
      }
      runAttempt.current = null;
      setRunResult(data.orderId);
      router.refresh();
      void fetchOrders();
    } catch { setError("Could not confirm the demo run. Check your orders before retrying."); }
    finally { setRunning(false); runInFlight.current = false; }
  }

  const availablePlans = plans.filter((p) => ["numbers", "esim", "proxies", "email-otp"].includes(p.service));
  const frequencies = [
    { id: "daily", label: "Daily" },
    { id: "weekly", label: "Weekly" },
    { id: "biweekly", label: "Biweekly" },
    { id: "monthly", label: "Monthly" },
  ];

  return (
    <div className="space-y-6">
      <PaymentLoading show={running} message="Running your demo schedule…" />
      <PaymentSuccess show={!!runResult} title="Demo schedule complete" message="A simulated order was created. No real service was purchased." redirectUrl={`/dashboard/orders/${runResult ?? ""}`} redirectDelay={2500} />
      {/* Create New Schedule */}
      <div role="status" className={`rounded-xl border p-4 text-sm ${preview ? "border-lav-200 bg-lav-50 text-lav-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
        {preview ? "Demo schedules run manually: select Run demo now to try one. No real service is delivered." : "Live scheduled purchasing is currently unavailable. Existing schedules can be paused or cancelled."}
      </div>
      <div className="rounded-xl border border-line bg-white p-6">
        <h2 className="text-[1.1rem] font-semibold text-ink mb-4">
          Create New Schedule
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-[0.86rem] font-medium text-ink mb-2">
              Select Product
            </label>
            <select
              value={selectedPlan}
              onChange={(e) => setSelectedPlan(e.target.value)}
              className="w-full rounded-xl border border-line bg-white px-4 py-3 text-[0.95rem] text-ink outline-none transition-colors focus:border-lav-600"
            >
              <option value="">Choose a product...</option>
              {availablePlans.map((plan) => (
                <option key={plan.slug} value={plan.slug}>
                  {plan.name} · {plan.planLabel} - {formatNaira(plan.price)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[0.86rem] font-medium text-ink mb-2">
              Frequency
            </label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {frequencies.map((freq) => (
                <button
                  key={freq.id}
                  onClick={() => setFrequency(freq.id)}
                  className={`rounded-xl border p-3 text-center transition-colors ${
                    frequency === freq.id
                      ? "border-lav-600 bg-lav-50 text-lav-700"
                      : "border-line bg-white text-ink hover:bg-cream"
                  }`}
                >
                  <span className="text-[0.86rem] font-semibold">{freq.label}</span>
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[0.9rem] text-red-700">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-[0.9rem] text-green-700">
              {success}
            </div>
          )}

          <button
            onClick={handleCreate}
            disabled={creating || !selectedPlan || !preview}
            className="w-full rounded-xl bg-lav-600 px-6 py-4 text-[1rem] font-semibold text-white transition-colors hover:bg-lav-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {creating ? "Creating..." : "Create Schedule"}
          </button>
        </div>
      </div>

      {/* Active Schedules */}
      <div>
        <h2 className="text-[1.1rem] font-semibold text-ink mb-4">
          Your Schedules
        </h2>
        {error && orders.length > 0 && <p role="alert" className="mb-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
        {historyState === "loading" ? (
          <p className="text-sm text-ink-2">Loading schedules…</p>
        ) : historyState === "error" ? (
          <p role="alert" className="text-sm text-rose-700">Schedules could not be loaded. <button type="button" className="font-semibold underline" onClick={() => void fetchOrders()}>Retry</button></p>
        ) : orders.length === 0 ? (
          <div className="rounded-xl border border-line bg-white p-8 text-center">
            <Calendar className="mx-auto h-12 w-12 text-ink-3 mb-3" />
            <p className="text-[0.95rem] text-ink-2">
              No scheduled orders yet
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => {
              const plan = findPlan(order.productSlug);
              if (!plan) return null;
              return (
                <div
                  key={order.id}
                  className="rounded-xl border border-line bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex-1">
                      <p className="text-[0.95rem] font-semibold text-ink">
                        {plan.name} · {plan.planLabel}
                      </p>
                      <p className="text-[0.82rem] text-ink-2">
                        {order.frequency.charAt(0).toUpperCase() + order.frequency.slice(1)} · {formatNaira(plan.price)}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-[0.75rem] font-semibold ${
                        order.status === "active"
                          ? "bg-emerald-50 text-emerald-700"
                          : order.status === "paused"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-ink/5 text-ink-2"
                      }`}
                    >
                      {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                    </span>
                  </div>
                  <div className="text-[0.82rem] text-ink-2 mb-3">
                    <p>Next run: {new Date(order.nextRunAt).toLocaleDateString()}</p>
                    {order.lastRunAt && (
                      <p>Last run: {new Date(order.lastRunAt).toLocaleDateString()}</p>
                    )}
                  </div>
                  {order.status !== "cancelled" && (
                    <div className="flex flex-wrap gap-2">
                      {preview && order.status === "active" && <button type="button" onClick={() => void runNow(order.id)} disabled={running || loading} className="flex items-center gap-2 rounded-lg bg-lav-600 px-3 py-2 text-[0.82rem] font-semibold text-white hover:bg-lav-700 disabled:opacity-50"><Play className="h-4 w-4" /> Run demo now</button>}
                      {order.status === "active" ? (
                        <button
                          onClick={() => handleAction(order.id, "pause")}
                          disabled={loading}
                          className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-[0.82rem] font-medium text-ink hover:bg-cream disabled:opacity-50"
                        >
                          <Pause className="h-4 w-4" />
                          Pause
                        </button>
                      ) : (
                        <button
                          onClick={() => handleAction(order.id, "resume")}
                          disabled={loading || !preview}
                          className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-[0.82rem] font-medium text-ink hover:bg-cream disabled:opacity-50"
                        >
                          <Play className="h-4 w-4" />
                          Resume
                        </button>
                      )}
                      <button
                        onClick={() => handleAction(order.id, "cancel")}
                        disabled={loading}
                        className="flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-[0.82rem] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                      >
                        <X className="h-4 w-4" />
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
