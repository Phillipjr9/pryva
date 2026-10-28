"use client";

import { useState } from "react";
import { dataPlans, findDataPlan, type AirtimeProvider } from "@/lib/airtime";
import { formatNaira } from "@/lib/catalog";
import { useRouter } from "next/navigation";
import type { DemoInventory } from "@/lib/demo-service-catalog";
import type { PublicUser } from "@/lib/auth";
import { NetworkBadge } from "@/components/NetworkBadge";
import { UnitsStatus } from "@/components/dashboard/UnitsStatus";

interface DataPlansFormProps {
  user: PublicUser;
  initialPlanId?: string;
  preview: boolean;
  inventory?: DemoInventory;
}

export function DataPlansForm({ user, initialPlanId, preview, inventory = {} }: DataPlansFormProps) {
  const router = useRouter();
  const initialPlan = initialPlanId ? findDataPlan(initialPlanId) : undefined;
  const [selectedProvider, setSelectedProvider] = useState<AirtimeProvider>(initialPlan?.provider ?? "mtn");
  const [selectedPlan, setSelectedPlan] = useState<string | null>(initialPlan?.id ?? null);

  const providers: { id: AirtimeProvider; name: string }[] = [
    { id: "mtn", name: "MTN" },
    { id: "airtel", name: "Airtel" },
    { id: "glo", name: "Glo" },
    { id: "9mobile", name: "9mobile" },
  ];

  const filteredPlans = dataPlans.filter((plan) => plan.provider === selectedProvider);

  function handlePurchase() {
    if (preview && selectedPlan) router.push(`/dashboard/services/demo/data-${encodeURIComponent(selectedPlan)}?country=ng`);
  }

  return (
    <div className="space-y-6">
        {/* Provider Selection */}
      <div>
        <label className="block text-[0.86rem] font-medium text-ink mb-3">
          Select Network
        </label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {providers.map((provider) => (
            <button
              key={provider.id}
              onClick={() => {
                setSelectedProvider(provider.id);
                setSelectedPlan(null);
              }}
              className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-colors ${
                selectedProvider === provider.id
                  ? "border-lav-600 bg-lav-50 text-lav-700"
                  : "border-line bg-white text-ink hover:bg-cream"
              }`}
            >
              <NetworkBadge provider={provider.id} size={36} />
              <span className="text-[0.9rem] font-semibold">{provider.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Plan Selection */}
      <div>
        <label className="block text-[0.86rem] font-medium text-ink mb-3">
          Select Data Plan
        </label>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredPlans.map((plan) => (
            <button
              key={plan.id}
              type="button"
              aria-pressed={selectedPlan === plan.id}
              onClick={() => setSelectedPlan(plan.id)}
              className={`rounded-xl border p-4 text-left transition-colors ${
                selectedPlan === plan.id
                  ? "border-lav-600 bg-lav-50"
                  : "border-line bg-white hover:bg-cream"
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[0.95rem] font-semibold text-ink">{plan.name}</p>
                  <p className="text-[0.82rem] text-ink-2">{plan.duration}</p>
                </div>
                <p className="text-[1.1rem] font-bold text-lav-600">
                  {formatNaira(plan.price)}
                </p>
              </div>
              <span className="mt-3 block"><UnitsStatus demo={preview} stock={inventory[`data-${plan.id}`]?.stock} owned={inventory[`data-${plan.id}`]?.owned} /></span>
            </button>
          ))}
        </div>
      </div>

      {preview && <p className="rounded-xl bg-lav-50 p-3 text-[0.76rem] text-lav-800">The demo uses a fictional mobile destination. No phone number is needed and no data is sent.</p>}

      {/* Wallet Balance */}
      <div className="rounded-xl border border-line bg-cream p-4">
        <p className="text-[0.86rem] text-ink-2">Wallet Balance</p>
        <p className="text-[1.5rem] font-bold text-ink">
          {formatNaira(user.walletBalance)}
        </p>
      </div>

      {/* Purchase Button */}
      <button
        onClick={handlePurchase}
        disabled={!preview || !selectedPlan}
        className="w-full rounded-xl bg-lav-600 px-6 py-4 text-[1rem] font-semibold text-white transition-colors hover:bg-lav-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {preview ? "Continue to demo checkout" : "Live data purchases paused"}
      </button>
    </div>
  );
}
