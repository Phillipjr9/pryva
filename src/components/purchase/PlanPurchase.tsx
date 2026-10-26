"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clock,
  Lock,
  Shield,
  Sparkle,
  Wallet,
} from "@/components/icons";
import { formatNaira, type Plan } from "@/lib/catalog";

type Group = { label: string; plans: Plan[] };
type CheckoutStep = "choose" | "review";

type Props = {
  groups: Group[];
  signedIn: boolean;
  walletBalance: number | null;
  nextPath: string;
  readOnlyDemo?: boolean;
  paystackReady?: boolean;
};

type Success = { id: string; reference: string; name: string };

function returnToCheckout(nextPath: string, planSlug: string): string {
  try {
    const target = new URL(nextPath, "https://pryva.invalid");
    if (target.origin !== "https://pryva.invalid") return "/pricing";
    target.searchParams.set("plan", planSlug);
    target.hash = "buy";
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return "/pricing";
  }
}

export function PlanPurchase({
  groups,
  signedIn,
  walletBalance,
  nextPath,
  readOnlyDemo = false,
  paystackReady = false,
}: Props) {
  const [tab, setTab] = useState(0);
  const plans = useMemo(() => groups[tab]?.plans ?? [], [groups, tab]);
  const [selectedSlug, setSelectedSlug] = useState<string>(
    () => (groups[0]?.plans.find((plan) => plan.popular) ?? groups[0]?.plans[0])?.slug ?? "",
  );
  const [step, setStep] = useState<CheckoutStep>("choose");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsFunds, setNeedsFunds] = useState(false);
  const [success, setSuccess] = useState<Success | null>(null);

  useEffect(() => {
    const requestedPlan = new URLSearchParams(window.location.search).get("plan");
    if (!requestedPlan) return;
    const groupIndex = groups.findIndex((item) => item.plans.some((plan) => plan.slug === requestedPlan));
    if (groupIndex < 0) return;

    const timer = window.setTimeout(() => {
      setTab(groupIndex);
      setSelectedSlug(requestedPlan);
      setStep("choose");
      setError(null);
      setNeedsFunds(false);
      const currentUrl = new URL(window.location.href);
      currentUrl.searchParams.delete("plan");
      window.history.replaceState(null, "", `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [groups]);

  const group = groups[tab];
  const selected = plans.find((plan) => plan.slug === selectedSlug) ?? plans[0];
  const shortfall = selected && walletBalance !== null
    ? Math.max(0, selected.price - walletBalance)
    : 0;
  const enoughFunds = walletBalance !== null && Boolean(selected) && walletBalance >= (selected?.price ?? 0);

  function changeTab(index: number) {
    setTab(index);
    const nextPlans = groups[index]?.plans ?? [];
    const preferred = nextPlans.find((plan) => plan.popular) ?? nextPlans[0];
    if (preferred) setSelectedSlug(preferred.slug);
    setStep("choose");
    setError(null);
    setNeedsFunds(false);
  }

  function selectPlan(plan: Plan) {
    setSelectedSlug(plan.slug);
    setStep("choose");
    setError(null);
    setNeedsFunds(false);
  }

  async function buy() {
    if (!selected || readOnlyDemo || !enoughFunds) return;
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
        window.location.href = `/login?next=${encodeURIComponent(nextPath)}`;
        return;
      }
      if (!response.ok || !data.ok || !data.order) {
        if (response.status === 402) {
          setNeedsFunds(true);
          setError(data.error ?? "Your wallet balance is too low for this order.");
        } else {
          setError(data.error ?? "We couldn't complete that order. Please try again.");
        }
        return;
      }
      setSuccess({
        id: data.order.id,
        reference: data.order.reference,
        name: data.order.productName,
      });
    } catch {
      setError("Network hiccup. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (success) {
    return (
      <div id="buy" className="pryva-checkout scroll-mt-28">
        <CheckoutProgress step={2} />
        <section className="pryva-checkout-success" aria-live="polite">
          <span className="pryva-checkout-success-mark"><Check className="h-6 w-6" /></span>
          <span className="pryva-section-eyebrow">PAYMENT CONFIRMED</span>
          <h3>Order placed.</h3>
          <p>
            <strong>{success.name}</strong> is now in your Pryva orders. Your order reference is <code>{success.reference}</code>.
          </p>
          <div className="pryva-checkout-success-actions">
            <Link href={`/dashboard/orders/${success.id}`} className="pryva-checkout-primary">
              View order details <ArrowRight className="h-4 w-4" />
            </Link>
            <button
              type="button"
              onClick={() => {
                setSuccess(null);
                setStep("choose");
                setError(null);
                setNeedsFunds(false);
              }}
              className="pryva-checkout-secondary"
            >
              Buy another
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div id="buy" className="pryva-checkout scroll-mt-28">
      <CheckoutProgress step={step === "review" ? 1 : 0} />

      {step === "choose" ? (
        <>
          {groups.length > 1 && (
            <div className="pryva-plan-tabs" role="tablist" aria-label="Service type">
              {groups.map((item, index) => (
                <button
                  key={item.label}
                  type="button"
                  role="tab"
                  aria-selected={tab === index}
                  onClick={() => changeTab(index)}
                  className={tab === index ? "is-selected" : ""}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}

          <div className="pryva-plan-grid">
            {plans.map((plan) => {
              const isSelected = plan.slug === selected?.slug;
              return (
                <button
                  key={plan.slug}
                  type="button"
                  onClick={() => selectPlan(plan)}
                  aria-pressed={isSelected}
                  className={`pryva-plan-card ${isSelected ? "is-selected" : ""}`}
                >
                  {plan.badge && (
                    <span className="pryva-plan-badge"><Sparkle className="h-3 w-3" /> {plan.badge}</span>
                  )}
                  <span className="pryva-plan-card-head">
                    <span>
                      <strong>{plan.flag && <span aria-hidden="true">{plan.flag} </span>}{plan.name}</strong>
                      <small>{plan.planLabel}</small>
                    </span>
                    <span className="pryva-plan-radio">{isSelected && <Check className="h-3 w-3" />}</span>
                  </span>
                  <span className="pryva-plan-price-row">
                    <strong>{formatNaira(plan.price)}</strong>
                    {plan.compareAt && <del>{formatNaira(plan.compareAt)}</del>}
                  </span>
                  <span className="pryva-plan-duration"><Clock className="h-3 w-3" /> {plan.duration}</span>
                  <span className="pryva-plan-rule" />
                  <span className="pryva-plan-features">
                    {plan.features.map((feature) => (
                      <span key={feature}><Check className="h-3.5 w-3.5" /> {feature}</span>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>

          <section className="pryva-checkout-summary">
            <div className="pryva-checkout-summary-copy">
              <span className="pryva-section-eyebrow">YOUR SELECTION</span>
              <strong>{selected ? `${selected.name} · ${selected.planLabel}` : "Choose a plan"}</strong>
              <span className="pryva-checkout-summary-notes">
                <span><Shield className="h-3.5 w-3.5" /> Eligible orders have refund protection</span>
                {signedIn && walletBalance !== null && (
                  <span><Wallet className="h-3.5 w-3.5" /> Wallet · {formatNaira(walletBalance)}</span>
                )}
              </span>
            </div>
            <div className="pryva-checkout-summary-action">
              <span>Total <strong>{selected ? formatNaira(selected.price) : "—"}</strong></span>
              <button
                type="button"
                onClick={() => {
                  setStep("review");
                  setError(null);
                  setNeedsFunds(false);
                }}
                disabled={!selected}
                className="pryva-checkout-primary"
              >
                Review order <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </section>
        </>
      ) : (
        <section className="pryva-checkout-review">
          <header className="pryva-checkout-review-header">
            <button type="button" onClick={() => setStep("choose")} className="pryva-checkout-back">
              <ArrowLeft className="h-3.5 w-3.5" /> Edit selection
            </button>
            <span className="pryva-section-eyebrow">02 / REVIEW &amp; PAY</span>
            <h3>Check the details</h3>
            <p>Confirm your service and total before paying from your Pryva wallet.</p>
          </header>

          {selected && (
            <div className="pryva-checkout-review-grid">
              <div className="pryva-checkout-product">
                <span className="pryva-checkout-product-icon"><Wallet className="h-5 w-5" /></span>
                <span className="pryva-section-eyebrow">{group?.label ?? "PRYVA SERVICE"}</span>
                <h4>{selected.name}</h4>
                <p>{selected.planLabel}</p>
                <span className="pryva-checkout-product-duration"><Clock className="h-3.5 w-3.5" /> {selected.duration}</span>
                <ul>
                  {selected.features.map((feature) => (
                    <li key={feature}><Check className="h-3.5 w-3.5" /> {feature}</li>
                  ))}
                </ul>
              </div>

              <dl className="pryva-checkout-receipt">
                <div><dt>Service</dt><dd>{group?.label ?? "Pryva service"}</dd></div>
                <div><dt>Plan</dt><dd>{selected.planLabel}</dd></div>
                <div><dt>Payment method</dt><dd>Pryva wallet</dd></div>
                <div><dt>Wallet balance</dt><dd>{walletBalance === null ? "Sign in to view" : formatNaira(walletBalance)}</dd></div>
                <div className="is-total"><dt>Due today</dt><dd>{formatNaira(selected.price)}</dd></div>
                <div className="is-after"><dt>Balance after order</dt><dd>{walletBalance === null ? "—" : enoughFunds ? formatNaira(walletBalance - selected.price) : "Insufficient balance"}</dd></div>
              </dl>
            </div>
          )}

          <div className="pryva-checkout-protection">
            <Shield className="h-4 w-4" />
            <span><strong>Refund protection</strong> · Eligible service orders can be refunded to your Pryva wallet.</span>
          </div>

          {readOnlyDemo && (
            <p className="pryva-checkout-notice is-demo" role="status">
              Read-only demo · This sample wallet cannot place or pay for orders.
            </p>
          )}
          {!readOnlyDemo && walletBalance !== null && shortfall > 0 && selected && (
            <div className="pryva-checkout-notice is-funds" role="status">
              <strong>You&apos;re {formatNaira(shortfall)} short.</strong>
              <span>
                {paystackReady
                  ? "Add funds with Paystack and return here to finish this order."
                  : "Paystack is not configured on this deployment yet. Choose a lower-priced plan or contact support."}
              </span>
              {paystackReady ? (
                <Link href={`/dashboard/wallet?returnTo=${encodeURIComponent(returnToCheckout(nextPath, selected.slug))}`}>
                  Add funds with Paystack <ArrowRight className="h-3 w-3" />
                </Link>
              ) : (
                <Link href="/dashboard/support">Contact support <ArrowRight className="h-3 w-3" /></Link>
              )}
            </div>
          )}
          {error && (
            <p className="pryva-checkout-error" role="alert">
              {error}{needsFunds && walletBalance !== null && shortfall === 0 ? " Your balance may have changed; review it in the wallet." : ""}
            </p>
          )}

          <div className="pryva-checkout-review-actions">
            <button type="button" onClick={() => setStep("choose")} className="pryva-checkout-secondary">
              Back to plans
            </button>
            {!signedIn ? (
              <Link href={`/login?next=${encodeURIComponent(nextPath)}`} className="pryva-checkout-primary">
                Sign in to continue <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <button
                type="button"
                onClick={buy}
                disabled={pending || readOnlyDemo || !enoughFunds}
                className="pryva-checkout-primary"
              >
                {pending ? "Confirming order…" : readOnlyDemo ? "Read-only demo" : `Confirm & pay ${selected ? formatNaira(selected.price) : ""}`}
                {!pending && !readOnlyDemo && <Lock className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
          <p className="pryva-checkout-footnote">
            <Lock className="h-3 w-3" /> The order is charged to your wallet after confirmation. No card or bank-transfer funding is available in this flow.
          </p>
        </section>
      )}
    </div>
  );
}

function CheckoutProgress({ step }: { step: number }) {
  const items = ["Choose a plan", "Review & pay", "Order placed"];
  return (
    <ol className="pryva-checkout-progress" aria-label="Checkout progress">
      {items.map((item, index) => {
        const state = index < step ? "is-done" : index === step ? "is-current" : "";
        return (
          <li key={item} className={state} aria-current={index === step ? "step" : undefined}>
            <span>{index < step ? <Check className="h-3.5 w-3.5" /> : `0${index + 1}`}</span>
            <strong>{item}</strong>
          </li>
        );
      })}
    </ol>
  );
}
