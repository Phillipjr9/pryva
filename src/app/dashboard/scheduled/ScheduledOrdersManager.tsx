"use client";

import { useState, useEffect } from "react";
import { plans, formatNaira, findPlan } from "@/lib/catalog";
import { Calendar, Pause, Play, X } from "@/components/icons";
import type { User } from "@/db/schema";

interface ScheduledOrdersManagerProps {
  user: User;
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

export function ScheduledOrdersManager({ user }: ScheduledOrdersManagerProps) {
  const [orders, setOrders] = useState<ScheduledOrder[]>([]);
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
    try {
      const response = await fetch("/api/scheduled-orders");
      const data = await response.json();
      if (data.ok) {
        setOrders(data.orders);
      }
    } catch (err) {
      console.error("Failed to fetch scheduled orders:", err);
    }
  }

  async function handleCreate() {
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

  const availablePlans = plans.filter((p) => ["numbers", "esim", "proxies", "email-otp"].includes(p.service));
  const frequencies = [
    { id: "daily", label: "Daily" },
    { id: "weekly", label: "Weekly" },
    { id: "biweekly", label: "Biweekly" },
    { id: "monthly", label: "Monthly" },
  ];

  return (
    <div className="space-y-6">
      {/* Create New Schedule */}
      <div className="rounded-xl border border-line bg-white p-6 dark:bg-gray-800 dark:border-gray-700">
        <h2 className="text-[1.1rem] font-semibold text-ink dark:text-gray-100 mb-4">
          Create New Schedule
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-[0.86rem] font-medium text-ink dark:text-gray-100 mb-2">
              Select Product
            </label>
            <select
              value={selectedPlan}
              onChange={(e) => setSelectedPlan(e.target.value)}
              className="w-full rounded-xl border border-line bg-white px-4 py-3 text-[0.95rem] text-ink outline-none transition-colors focus:border-lav-600 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 dark:focus:border-lav-500"
            >
              <option value="">Choose a product...</option>
              {availablePlans.map((plan) => (
                <option key={plan.slug} value={plan.slug}>
                  {plan.name} - {formatNaira(plan.price)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[0.86rem] font-medium text-ink dark:text-gray-100 mb-2">
              Frequency
            </label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {frequencies.map((freq) => (
                <button
                  key={freq.id}
                  onClick={() => setFrequency(freq.id)}
                  className={`rounded-xl border p-3 text-center transition-colors ${
                    frequency === freq.id
                      ? "border-lav-600 bg-lav-50 text-lav-700 dark:bg-lav-900/20 dark:border-lav-500 dark:text-lav-300"
                      : "border-line bg-white text-ink hover:bg-cream dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-600"
                  }`}
                >
                  <span className="text-[0.86rem] font-semibold">{freq.label}</span>
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[0.9rem] text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-[0.9rem] text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-300">
              {success}
            </div>
          )}

          <button
            onClick={handleCreate}
            disabled={creating || !selectedPlan}
            className="w-full rounded-xl bg-lav-600 px-6 py-4 text-[1rem] font-semibold text-white transition-colors hover:bg-lav-700 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-lav-500 dark:hover:bg-lav-600"
          >
            {creating ? "Creating..." : "Create Schedule"}
          </button>
        </div>
      </div>

      {/* Active Schedules */}
      <div>
        <h2 className="text-[1.1rem] font-semibold text-ink dark:text-gray-100 mb-4">
          Your Schedules
        </h2>
        {orders.length === 0 ? (
          <div className="rounded-xl border border-line bg-white p-8 text-center dark:bg-gray-800 dark:border-gray-700">
            <Calendar className="mx-auto h-12 w-12 text-ink-3 dark:text-gray-600 mb-3" />
            <p className="text-[0.95rem] text-ink-2 dark:text-gray-400">
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
                  className="rounded-xl border border-line bg-white p-4 dark:bg-gray-800 dark:border-gray-700"
                >
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex-1">
                      <p className="text-[0.95rem] font-semibold text-ink dark:text-gray-100">
                        {plan.name}
                      </p>
                      <p className="text-[0.82rem] text-ink-2 dark:text-gray-400">
                        {order.frequency.charAt(0).toUpperCase() + order.frequency.slice(1)} · {formatNaira(plan.price)}
                      </p>
                    </div>
                    <span
                      className={`rounded-full px-3 py-1 text-[0.75rem] font-semibold ${
                        order.status === "active"
                          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                          : order.status === "paused"
                          ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300"
                          : "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300"
                      }`}
                    >
                      {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                    </span>
                  </div>
                  <div className="text-[0.82rem] text-ink-2 dark:text-gray-400 mb-3">
                    <p>Next run: {new Date(order.nextRunAt).toLocaleDateString()}</p>
                    {order.lastRunAt && (
                      <p>Last run: {new Date(order.lastRunAt).toLocaleDateString()}</p>
                    )}
                  </div>
                  {order.status !== "cancelled" && (
                    <div className="flex gap-2">
                      {order.status === "active" ? (
                        <button
                          onClick={() => handleAction(order.id, "pause")}
                          disabled={loading}
                          className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-[0.82rem] font-medium text-ink hover:bg-cream disabled:opacity-50 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-600"
                        >
                          <Pause className="h-4 w-4" />
                          Pause
                        </button>
                      ) : (
                        <button
                          onClick={() => handleAction(order.id, "resume")}
                          disabled={loading}
                          className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-[0.82rem] font-medium text-ink hover:bg-cream disabled:opacity-50 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-600"
                        >
                          <Play className="h-4 w-4" />
                          Resume
                        </button>
                      )}
                      <button
                        onClick={() => handleAction(order.id, "cancel")}
                        disabled={loading}
                        className="flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2 text-[0.82rem] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:bg-gray-700 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
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
