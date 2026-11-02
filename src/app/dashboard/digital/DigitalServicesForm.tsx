"use client";

import { useState } from "react";
import { type DigitalService } from "@/lib/digital-services";
import { formatNaira } from "@/lib/catalog";
import { ServiceIcon } from "@/components/ServiceIcon";
import type { PublicUser } from "@/lib/auth";
import { MappedProductBuyButton } from "@/components/purchase/MappedProductBuyButton";

interface DigitalServicesFormProps {
  user: PublicUser;
  service: DigitalService;
  countryCode?: string;
  backHref?: string;
  /** Server-computed: our own plan IDs mapped to a verified supplier product. */
  mappedPlanIds?: string[];
  enabled?: boolean;
}

export function DigitalServicesForm({ user, service, countryCode, backHref = "/dashboard/digital", mappedPlanIds = [], enabled = false }: DigitalServicesFormProps) {
  const [selection, setSelection] = useState<{ service: string; country: string | undefined; plan: string } | null>(null);
  const selectedPlan = selection?.service === service.slug && selection.country === countryCode ? selection.plan : null;
  const selectedPlanData = service.plans.find((p) => p.id === selectedPlan);

  // Without a mapped supplier product this form stays browse-only: no submit,
  // and nothing can be ordered or charged.

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center gap-4 mb-6">
        <a href={backHref} className="text-ink-3 hover:text-ink">
          ← Back
        </a>
        <div className="flex items-center gap-4">
          <ServiceIcon service={service.slug as any} size="lg" />
          <div>
            <h2 className="text-xl font-bold text-ink">{service.name}</h2>
            <p className="text-sm text-ink-3">
              {enabled
                ? "Choose a verified plan to buy from your wallet. Delivery codes appear on the order."
                : "Digital subscriptions are not available for purchase yet."}
            </p>
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
              onClick={() => setSelection({ service: service.slug, country: countryCode, plan: plan.id })}
              className={`card p-6 text-left transition-all ${
                selectedPlan === plan.id
                  ? "ring-2 ring-lav-600 scale-[1.02]"
                  : "hover:scale-[1.01]"
              }`}
            >
              <h3 className="text-lg font-bold text-ink mb-2">{plan.name}</h3>
              <p className="text-sm text-ink-3 mb-4">{plan.duration}</p>
              <p className="mb-1 text-xs text-ink-3">Price</p>
              <p className="mb-4 text-2xl font-bold text-lav-600">{formatNaira(plan.price)}</p>
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

      {/* Purchase Button */}
      {enabled && selectedPlanData && mappedPlanIds.includes(selectedPlanData.id) ? (
        <MappedProductBuyButton
          family="subscriptions"
          planId={selectedPlanData.id}
          name={`${service.name} ${selectedPlanData.name}`}
          price={selectedPlanData.price}
          walletBalance={user.walletBalance}
        />
      ) : (
        <button
          type="button"
          disabled
          className="btn btn-primary w-full text-lg py-4 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {enabled
            ? selectedPlanData ? "This plan isn't available for delivery yet" : "Select a plan"
            : "Digital subscriptions are not available yet"}
        </button>
      )}
    </div>
    </>
  );
}
