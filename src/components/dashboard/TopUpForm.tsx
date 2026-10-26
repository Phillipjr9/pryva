"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Card, Check, Clock, Lock, Wallet } from "@/components/icons";
import { formatNaira } from "@/lib/catalog";

const presets = [2000, 5000, 10000, 25000, 50000];

export function TopUpForm({ balance }: { balance: number }) {
  const router = useRouter();
  const [amount, setAmount] = useState<number>(5000);
  const [custom, setCustom] = useState("");
  const [method, setMethod] = useState<"bank-transfer" | "card">("bank-transfer");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ amount: number; reference: string } | null>(null);

  const effectiveAmount = custom ? Math.round(Number(custom)) : amount;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch("/api/wallet/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: effectiveAmount, method }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        reference?: string;
      };
      if (!response.ok || !data.ok) {
        setError(data.error ?? "That top-up didn't go through.");
        return;
      }
      setSuccess({ amount: effectiveAmount, reference: data.reference ?? "TOP" });
      setCustom("");
      router.refresh();
    } catch {
      setError("Network hiccup. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[1.05rem] font-semibold">Fund your wallet</h2>
        <span className="rounded-full bg-cream px-2.5 py-1 text-[0.66rem] font-medium text-ink-2">
          Balance {formatNaira(balance)}
        </span>
      </div>

      <div className="mt-4">
        <p className="field-label">Choose an amount</p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {presets.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                setAmount(preset);
                setCustom("");
              }}
              className={`rounded-xl border px-2 py-2.5 text-[0.78rem] font-semibold transition-all ${
                !custom && amount === preset
                  ? "border-lav-400 bg-lav-50 text-lav-800"
                  : "border-line bg-white text-ink-2 hover:border-lav-200"
              }`}
            >
              {formatNaira(preset)}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <label htmlFor="custom" className="field-label">
          Or enter an amount
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[0.9rem] text-ink-3">
            ₦
          </span>
          <input
            id="custom"
            inputMode="numeric"
            className="field !pl-8"
            placeholder="e.g. 7500"
            value={custom}
            onChange={(event) => setCustom(event.target.value.replace(/[^\d]/g, ""))}
          />
        </div>
        <p className="mt-1.5 text-[0.7rem] text-ink-3">
          Minimum ₦1,000 · maximum ₦500,000 per top-up
        </p>
      </div>

      <div className="mt-4">
        <p className="field-label">Payment method</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            {
              id: "bank-transfer" as const,
              label: "Bank transfer",
              note: "Instant credit · demo",
              icon: Wallet,
            },
            { id: "card" as const, label: "Debit card", note: "Local Naira card", icon: Card },
          ].map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setMethod(option.id)}
                className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left transition-all ${
                  method === option.id
                    ? "border-lav-400 bg-lav-50"
                    : "border-line bg-white hover:border-lav-200"
                }`}
              >
                <Icon className="h-4 w-4 text-lav-700" />
                <span className="flex-1">
                  <span className="block text-[0.8rem] font-semibold text-ink">{option.label}</span>
                  <span className="block text-[0.68rem] text-ink-3">{option.note}</span>
                </span>
                {method === option.id && <Check className="h-4 w-4 text-lav-700" />}
              </button>
            );
          })}
        </div>
      </div>

      {error && <p className="mt-3 text-[0.78rem] font-medium text-rose-600">{error}</p>}
      {success && (
        <p className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[0.78rem] font-medium text-emerald-700">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          {formatNaira(success.amount)} added to your wallet. Reference {success.reference}.
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !Number.isFinite(effectiveAmount) || effectiveAmount < 1000}
        className="btn btn-primary mt-4 w-full !py-3.5 disabled:opacity-60"
      >
        {pending ? "Adding funds…" : `Add ${formatNaira(Number.isFinite(effectiveAmount) ? effectiveAmount : 0)}`}
        {!pending && <ArrowRight className="h-4 w-4" />}
      </button>

      <p className="mt-3 flex items-start gap-1.5 text-[0.7rem] leading-relaxed text-ink-3">
        <Lock className="mt-0.5 h-3 w-3 shrink-0 text-lav-500" />
        Preview environment: top-ups credit instantly so you can test the full flow. Live funding uses
        Nigerian bank transfer and cards.
      </p>
      <p className="mt-1 flex items-start gap-1.5 text-[0.7rem] leading-relaxed text-ink-3">
        <Clock className="mt-0.5 h-3 w-3 shrink-0 text-lav-500" />
        Wallet balance stays valid for 90 days from your last activity.
      </p>
    </form>
  );
}
