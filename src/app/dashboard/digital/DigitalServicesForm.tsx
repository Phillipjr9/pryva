"use client";

import { useRef, useState } from "react";
import type { DemoDigitalInventory } from "@/lib/demo-digital";
import { type DigitalService } from "@/lib/digital-services";
import { formatNaira } from "@/lib/catalog";
import { ServiceIcon } from "@/components/ServiceIcon";
import { PaymentSuccess } from "@/components/ui/PaymentSuccess";
import { PaymentLoading } from "@/components/ui/PaymentLoading";
import type { PublicUser } from "@/lib/auth";
import { UnitsStatus } from "@/components/dashboard/UnitsStatus";

interface DigitalServicesFormProps {
  user: PublicUser;
  service: DigitalService;
  preview: boolean;
  inventory?: DemoDigitalInventory;
  countryCode?: string;
  backHref?: string;
}

export function DigitalServicesForm({ user, service, preview, inventory = {}, countryCode, backHref = "/dashboard/digital" }: DigitalServicesFormProps) {
  const [selection, setSelection] = useState<{ service: string; country: string | undefined; plan: string } | null>(null);
  const selectedPlan = selection?.service === service.slug && selection.country === countryCode ? selection.plan : null;
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef<{ planId: string; requestId: string; country?: string } | null>(null);
  const inFlight = useRef(false);

  const selectedPlanData = service.plans.find((p) => p.id === selectedPlan);

  async function handlePurchase() {
    if (!preview || !selectedPlanData || inFlight.current) return;
    if (attempt.current && (attempt.current.planId !== selectedPlanData.id || attempt.current.country !== countryCode)) {
      setError("Check your orders and retry the previous demo plan before starting another.");
      return;
    }
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      attempt.current ??= { planId: selectedPlanData.id, requestId: crypto.randomUUID(), ...(countryCode ? { country: countryCode } : {}) };
      const [response] = await Promise.all([
        fetch("/api/demo/digital", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(attempt.current) }),
        new Promise((resolve) => setTimeout(resolve, 1600)),
      ]);
      const data = await response.json() as { ok?: boolean; simulated?: boolean; orderId?: string; error?: string };
      if (!response.ok || !data.ok || !data.simulated || !data.orderId) {
        if (response.status >= 400 && response.status < 500 && response.status !== 409) attempt.current = null;
        setError(data.error ?? "Could not confirm the demo order. Check your orders before retrying.");
        return;
      }
      attempt.current = null;
      setSuccess(data.orderId);
    } catch {
      setError("Could not confirm the demo order. Check your orders before retrying.");
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }

  return (
    <>
      <PaymentLoading show={loading} message="Processing your purchase..." />
      <PaymentSuccess
        show={!!success}
        title="Demo order complete"
        message="This simulated subscription has no real account access."
        redirectUrl={`/dashboard/orders/${success ?? ""}`}
        redirectDelay={2500}
      />
      <div className="space-y-6">
        <div className="flex items-center gap-4 mb-6">
        <a href={backHref} className="text-ink-3 hover:text-ink">
          ← Back
        </a>
        <div className="flex items-center gap-4">
          <ServiceIcon service={service.slug as any} size="lg" />
          <div>
            <h2 className="text-xl font-bold text-ink">{service.name}</h2>
            <p className="text-sm text-ink-3">{preview ? "Choose a fictional demo subscription." : "Country coverage and live stock are unverified."}</p>
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
              type="button"
              aria-pressed={selectedPlan === plan.id}
              disabled={loading || !!success}
              onClick={() => setSelection({ service: service.slug, country: countryCode, plan: plan.id })}
              className={`card p-6 text-left transition-all ${
                selectedPlan === plan.id
                  ? "ring-2 ring-lav-600 scale-[1.02]"
                  : "hover:scale-[1.01]"
              }`}
            >
              <h3 className="text-lg font-bold text-ink mb-2">{plan.name}</h3>
              <p className="text-sm text-ink-3 mb-4">{plan.duration}</p>
              <p className="mb-1 text-xs text-ink-3">{preview ? "Demo price" : "Preview price"}</p>
              <p className="mb-4 text-2xl font-bold text-lav-600">{formatNaira(plan.price)}</p>
              <UnitsStatus demo={preview} stock={inventory[plan.id]?.stock} owned={inventory[plan.id]?.owned} />
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
        disabled={!preview || loading || !!success || !selectedPlanData || (inventory[selectedPlanData.id]?.stock === 0)}
        className="btn btn-primary w-full text-lg py-4 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Processing..." : !preview ? "Live purchases paused" : selectedPlanData && inventory[selectedPlanData.id]?.stock === 0 ? "Demo stock exhausted" : selectedPlanData ? `Pay ${formatNaira(selectedPlanData.price)} with demo wallet` : "Select a plan"}
      </button>
    </div>
    </>
  );
}
