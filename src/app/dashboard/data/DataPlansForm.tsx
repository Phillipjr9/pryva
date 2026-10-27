"use client";

import { useState } from "react";
import { dataPlans, type AirtimeProvider } from "@/lib/airtime";
import { formatNaira } from "@/lib/catalog";
import { PaymentSuccess } from "@/components/ui/PaymentSuccess";
import { PaymentLoading } from "@/components/ui/PaymentLoading";
import type { PublicUser } from "@/lib/auth";
import { NetworkBadge } from "@/components/NetworkBadge";

interface DataPlansFormProps {
  user: PublicUser;
}

export function DataPlansForm({ user }: DataPlansFormProps) {
  const [selectedProvider, setSelectedProvider] = useState<AirtimeProvider>("mtn");
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{ amount: number; reference?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const providers: { id: AirtimeProvider; name: string }[] = [
    { id: "mtn", name: "MTN" },
    { id: "airtel", name: "Airtel" },
    { id: "glo", name: "Glo" },
    { id: "9mobile", name: "9mobile" },
  ];

  const filteredPlans = dataPlans.filter((plan) => plan.provider === selectedProvider);

  async function handlePurchase() {
    if (!selectedPlan || !phoneNumber) {
      setError("Please select a plan and enter a phone number");
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(null);
    setReceipt(null);

    try {
      const response = await fetch("/api/airtime/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: selectedPlan, phoneNumber }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Purchase failed");
      }

      setSuccess(data.message);
      // The endpoint already returns the order it created; the receipt shows that
      // rather than a generic "success", so the figure and reference on screen are
      // the ones support will ask for.
      setReceipt({
        amount: typeof data.order?.amount === "number" ? data.order.amount : 0,
        reference: typeof data.order?.reference === "string" ? data.order.reference : undefined,
      });
      setSelectedPlan(null);
      setPhoneNumber("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Purchase failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PaymentLoading show={loading} message="Processing your data plan purchase…" />
      <PaymentSuccess
        show={!!success}
        title="Data plan purchased"
        message={success || "Your data plan has been activated."}
        amount={receipt?.amount || undefined}
        reference={receipt?.reference}
        redirectUrl="/dashboard/orders"
        redirectDelay={2500}
      />
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
            </button>
          ))}
        </div>
      </div>

      {/* Phone Number */}
      <div>
        <label className="block text-[0.86rem] font-medium text-ink mb-2">
          Phone Number
        </label>
        <input
          type="tel"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
          placeholder="08012345678"
          className="w-full rounded-xl border border-line bg-white px-4 py-3 text-[0.95rem] text-ink outline-none transition-colors focus:border-lav-600"
        />
      </div>

      {/* Wallet Balance */}
      <div className="rounded-xl border border-line bg-cream p-4">
        <p className="text-[0.86rem] text-ink-2">Wallet Balance</p>
        <p className="text-[1.5rem] font-bold text-ink">
          {formatNaira(user.walletBalance)}
        </p>
      </div>

      {/* Messages */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[0.9rem] text-red-700">
          {error}
        </div>
      )}

      {/* Purchase Button */}
      <button
        onClick={handlePurchase}
        disabled={loading || !selectedPlan || !phoneNumber}
        className="w-full rounded-xl bg-lav-600 px-6 py-4 text-[1rem] font-semibold text-white transition-colors hover:bg-lav-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Processing..." : "Purchase Data Plan"}
      </button>
    </div>
    </>
  );
}
