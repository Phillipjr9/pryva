"use client";

import { useState } from "react";
import { type DigitalService } from "@/lib/digital-services";
import { formatNaira } from "@/lib/catalog";
import { ServiceIcon } from "@/components/ServiceIcon";
import { PaymentSuccess } from "@/components/ui/PaymentSuccess";
import { PaymentLoading } from "@/components/ui/PaymentLoading";
import type { User } from "@/db/schema";

interface DigitalServicesFormProps {
  user: User;
  service: DigitalService;
}

export function DigitalServicesForm({ user, service }: DigitalServicesFormProps) {
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPlanData = service.plans.find((p) => p.id === selectedPlan);

  async function handlePurchase() {
    if (!selectedPlan) {
      setError("Please select a plan");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/digital/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: selectedPlan }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Purchase failed");
      }

      setSuccess(true);
      setSelectedPlan(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Purchase failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PaymentLoading show={loading} message="Processing your purchase..." />
      <PaymentSuccess
        show={success}
        title="Purchase Successful!"
        message="Your account credentials will be sent to your email within 5 minutes."
        redirectUrl="/dashboard"
        redirectDelay={2500}
      />
      <div className="space-y-6">
        <div className="flex items-center gap-4 mb-6">
        <a href="/dashboard/digital" className="text-ink-3 hover:text-ink">
          ← Back
        </a>
        <div className="flex items-center gap-4">
          <ServiceIcon service={service.slug as any} size="lg" />
          <div>
            <h2 className="text-xl font-bold text-ink">{service.name}</h2>
            <p className="text-sm text-ink-3">{service.description}</p>
          </div>
        </div>
      </div>

      {/* Plans */}
      <div>
        <label className="block text-[0.86rem] font-medium text-ink mb-3">
          Select Plan
        </label>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {service.plans.map((plan) => (
            <button
              key={plan.id}
              onClick={() => setSelectedPlan(plan.id)}
              className={`card p-6 text-left transition-all ${
                selectedPlan === plan.id
                  ? "ring-2 ring-lav-600 scale-[1.02]"
                  : "hover:scale-[1.01]"
              }`}
            >
              {plan.badge && (
                <div className="inline-block bg-lav-100 text-lav-700 text-xs font-semibold px-2 py-1 rounded mb-2">
                  {plan.badge}
                </div>
              )}
              <h3 className="text-lg font-bold text-ink mb-2">{plan.name}</h3>
              <p className="text-sm text-ink-3 mb-4">{plan.duration}</p>
              <div className="mb-4">
                {plan.compareAt && (
                  <span className="text-sm text-ink-3 line-through mr-2">
                    {formatNaira(plan.compareAt)}
                  </span>
                )}
                <span className="text-2xl font-bold text-lav-600">
                  {formatNaira(plan.price)}
                </span>
              </div>
              <ul className="space-y-2">
                {plan.features.slice(0, 3).map((feature, idx) => (
                  <li key={idx} className="text-sm text-ink-2 flex items-start gap-2">
                    <span className="text-lav-600 mt-0.5">✓</span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </button>
          ))}
        </div>
      </div>

      {/* Selected Plan Details */}
      {selectedPlanData && (
        <div className="card p-6 bg-lav-50">
          <h3 className="font-semibold text-ink mb-4">Selected Plan</h3>
          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-ink-2">Plan</span>
              <span className="font-semibold text-ink">{selectedPlanData.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-2">Duration</span>
              <span className="font-semibold text-ink">{selectedPlanData.duration}</span>
            </div>
            <div className="flex justify-between text-lg">
              <span className="text-ink-2">Total</span>
              <span className="font-bold text-lav-600">{formatNaira(selectedPlanData.price)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Wallet Balance */}
      <div className="card p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-ink-3">Your Wallet Balance</p>
            <p className="text-2xl font-bold text-ink">{formatNaira(user.walletBalance)}</p>
          </div>
          {selectedPlanData && user.walletBalance < selectedPlanData.price && (
            <a href="/dashboard/wallet" className="btn btn-ghost">
              Top Up Wallet
            </a>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[0.9rem] text-red-700">
          {error}
        </div>
      )}

      {/* Purchase Button */}
      <button
        onClick={handlePurchase}
        disabled={loading || !selectedPlan}
        className="btn btn-primary w-full text-lg py-4 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Processing..." : selectedPlan ? `Purchase for ${formatNaira(selectedPlanData?.price || 0)}` : "Select a Plan"}
      </button>
    </div>
    </>
  );
}
