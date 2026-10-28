"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Lock, Shield, Sparkle } from "@/components/icons";
import { formatNaira, type Plan } from "@/lib/catalog";
import { PaymentSuccess } from "@/components/ui/PaymentSuccess";
import { CountryFlag } from "@/components/CountryFlag";
import { hasCountryFlag } from "@/lib/countries";
import { PaymentLoading } from "@/components/ui/PaymentLoading";
import { UnitsStatus } from "@/components/dashboard/UnitsStatus";

type Group = { label: string; plans: Plan[] };

type Props = {
  groups: Group[];
  signedIn: boolean;
  walletBalance: number | null;
  nextPath: string;
  /** Explicitly label preview checkout so it cannot be mistaken for live delivery. */
  previewOnly?: boolean;
};

export function PlanPurchase({ groups, signedIn, walletBalance, nextPath, previewOnly = false }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState(0);
  const plans = useMemo(() => groups[tab]?.plans ?? [], [groups, tab]);
  const [selectedSlug, setSelectedSlug] = useState<string>(
    () => (groups[0]?.plans.find((plan) => plan.popular) ?? groups[0]?.plans[0])?.slug ?? "",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsFunds, setNeedsFunds] = useState(false);
  const [success, setSuccess] = useState<{ id: string; reference: string; name: string } | null>(
    null,
  );

  const selected = plans.find((plan) => plan.slug === selectedSlug) ?? plans[0];

  function changeTab(index: number) {
    setTab(index);
    const nextPlans = groups[index]?.plans ?? [];
    const preferred = nextPlans.find((plan) => plan.popular) ?? nextPlans[0];
    if (preferred) setSelectedSlug(preferred.slug);
    setError(null);
    setNeedsFunds(false);
  }

  async function buy() {
    if (!selected) return;
    setPending(true);
    setError(null);
    setNeedsFunds(false);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planSlug: selected.slug }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        order?: { id: string; reference: string; productName: string };
      };

      if (response.status === 401) {
        router.push(`/login?next=${encodeURIComponent(nextPath)}`);
        return;
      }
      if (!response.ok || !data.ok || !data.order) {
        setError(data.error ?? "We couldn't complete that order. Please try again.");
        if (response.status === 402) setNeedsFunds(true);
        return;
      }
      setSuccess({
        id: data.order.id,
        reference: data.order.reference,
        name: data.order.productName,
      });
      router.refresh();
    } catch {
      setError("Network hiccup. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <PaymentLoading show={pending} message="Processing your order..." />
      <PaymentSuccess
        show={!!success}
        title="Preview Order Complete"
        message={`${success?.name} is simulated and is now in your dashboard.`}
        redirectUrl={`/dashboard/orders/${success?.id}`}
        redirectDelay={2500}
      />

      {success && (
        <div className="card relative overflow-hidden p-7 sm:p-9">
          <div className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full bg-lav-100 blur-2xl" />
          <span className="grid h-12 w-12 place-items-center rounded-full bg-lav-100 text-lav-700">
            <Check className="h-6 w-6" />
          </span>
          <h3 className="mt-5 text-2xl font-medium">Preview order complete.</h3>
          <p className="mt-2 max-w-md text-[0.92rem] leading-relaxed text-ink-2">
            <span className="font-semibold text-ink">{success.name}</span> is simulated; no live service was delivered. The preview order is now in your dashboard.
            Order reference{" "}
            <span className="rounded-md bg-lav-50 px-1.5 py-0.5 font-mono text-[0.8rem] text-lav-700">
              {success.reference}
            </span>
            .
          </p>
          <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
            <Link href={`/dashboard/orders/${success.id}`} className="btn btn-primary">
              View code &amp; details
              <ArrowRight className="h-4 w-4" />
            </Link>
            <button
              type="button"
              onClick={() => setSuccess(null)}
              className="btn btn-ghost"
            >
              Buy another
            </button>
          </div>
        </div>
      )}

      {!success && (
        <div id="buy" className="scroll-mt-28">
          {groups.length > 1 && (
            <div className="mb-6 inline-flex items-center gap-1 rounded-full border border-line bg-white/70 p-1">
              {groups.map((group, index) => (
                <button
                  key={group.label}
                  type="button"
                  onClick={() => changeTab(index)}
                  className={`rounded-full px-4 py-2 text-[0.82rem] font-semibold transition-all ${
                    tab === index
                      ? "bg-ink text-white shadow-sm"
                      : "text-ink-2 hover:bg-lav-50 hover:text-lav-700"
                  }`}
                >
                  {group.label}
                </button>
              ))}
            </div>
          )}

          <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
            {plans.map((plan) => {
              const isSelected = plan.slug === selected?.slug;
              return (
                <button
                  key={plan.slug}
                  type="button"
                  onClick={() => {
                    setSelectedSlug(plan.slug);
                    setError(null);
                    setNeedsFunds(false);
                  }}
                  aria-pressed={isSelected}
                  className={`group relative flex flex-col rounded-3xl border p-5 text-left transition-all duration-300 ${
                    isSelected
                      ? "border-lav-300 bg-white shadow-[var(--shadow-soft)] ring-1 ring-lav-300"
                      : "border-line bg-white/60 hover:-translate-y-0.5 hover:border-lav-200 hover:bg-white"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="flex items-center gap-2 text-[0.95rem] font-semibold text-ink">
                        {hasCountryFlag(plan.region) && (
                          <CountryFlag region={plan.region} size={20} decorative />
                        )}
                        {plan.name}
                      </span>
                      <span className="mt-1 block text-[0.76rem] text-ink-3">{plan.planLabel}</span>
                    </div>
                    <span
                      className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors ${
                        isSelected
                          ? "border-lav-500 bg-lav-500 text-white"
                          : "border-line text-transparent"
                      }`}
                    >
                      <Check className="h-3 w-3" />
                    </span>
                  </div>

                  <div className="mt-4 flex items-end gap-2">
                    <span className="text-[1.55rem] font-semibold leading-none tracking-tight">
                      {formatNaira(plan.price)}
                    </span>
                    {plan.compareAt && (
                      <span className="pb-0.5 text-[0.78rem] text-ink-3 line-through">
                        {formatNaira(plan.compareAt)}
                      </span>
                    )}
                  </div>
                  <span className="mt-1.5 text-[0.74rem] text-ink-3">{plan.duration}</span>
                  <span className="mt-3 block w-full"><UnitsStatus /></span>

                  <ul className="mt-4 space-y-1.5">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-1.5 text-[0.78rem] text-ink-2">
                        <Check className="mt-0.5 h-3 w-3 shrink-0 text-lav-500" />
                        {feature}
                      </li>
                    ))}
                  </ul>

                  {plan.badge && (
                    <span className="absolute -top-2.5 right-4 inline-flex items-center gap-1 rounded-full bg-lav-100 px-2.5 py-1 text-[0.62rem] font-bold uppercase tracking-[0.1em] text-lav-700">
                      <Sparkle className="h-2.5 w-2.5" />
                      {plan.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-6 flex flex-col gap-4 rounded-3xl border border-line bg-gradient-to-br from-white to-lav-50/70 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-ink-3">
                Your selection
              </p>
              <p className="mt-1 text-[0.95rem] font-semibold text-ink">
                {selected ? `${selected.name} · ${selected.planLabel}` : "Choose a plan"}
              </p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.74rem] text-ink-3">
                <span className="inline-flex items-center gap-1">
                  <Shield className="h-3 w-3 text-lav-500" /> Support for delivery issues
                </span>
                <span className="inline-flex items-center gap-1">
                  <Lock className="h-3 w-3 text-lav-500" /> Secure Naira checkout
                </span>
                {signedIn && walletBalance !== null && (
                  <span className="inline-flex items-center gap-1">
                    Wallet: <span className="font-semibold text-ink-2">{formatNaira(walletBalance)}</span>
                  </span>
                )}
              </p>
            </div>

            <div className="flex flex-col items-stretch gap-2 sm:items-end">
              <div className="flex items-center gap-3 sm:justify-end">
                <span className="text-[0.78rem] text-ink-3">Total</span>
                <span className="text-[1.5rem] font-semibold leading-none">
                  {selected ? formatNaira(selected.price) : "—"}
                </span>
              </div>
              {signedIn ? (
                <button
                  type="button"
                  onClick={buy}
                  disabled={pending || !selected}
                  className="btn btn-primary w-full disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                >
                  {pending ? "Processing…" : previewOnly ? "Create simulated order" : "Pay from wallet"}
                  {!pending && <ArrowRight className="h-4 w-4" />}
                </button>
              ) : (
                <Link
                  href={`/login?next=${encodeURIComponent(nextPath)}`}
                  className="btn btn-primary w-full sm:w-auto"
                >
                  Sign in to buy
                  <ArrowRight className="h-4 w-4" />
                </Link>
              )}
              {error && (
                <p className="max-w-xs text-right text-[0.76rem] font-medium text-rose-600">
                  {error}
                  {needsFunds && (
                    <>
                      {" "}
                      <Link href="/dashboard/wallet" className="underline">
                        Top up your wallet
                      </Link>
                    </>
                  )}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
