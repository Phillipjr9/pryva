"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Card, Check, Clock, Lock, Refresh, Shield, Wallet } from "@/components/icons";
import { formatNaira } from "@/lib/catalog";

const presets = [1000, 2000, 5000, 10000, 25000, 50000];

type PaymentResult = {
  status: "paid" | "pending" | "failed";
  amount: number;
  reference: string;
} | null;

export function TopUpForm({
  balance,
  previewMode = false,
  paystackReady = false,
  paymentResult = null,
  returnTo = null,
}: {
  balance: number;
  previewMode?: boolean;
  paystackReady?: boolean;
  paymentResult?: PaymentResult;
  returnTo?: string | null;
}) {
  const [step, setStep] = useState<"amount" | "review">("amount");
  const [amount, setAmount] = useState(5000);
  const [custom, setCustom] = useState("");
  const [method, setMethod] = useState<"bank-transfer" | "card">("bank-transfer");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveAmount = custom.trim() ? Number(custom) : amount;
  const amountIsValid =
    Number.isSafeInteger(effectiveAmount) && effectiveAmount >= 1000 && effectiveAmount <= 500000;
  const methodLabel = method === "card" ? "Local debit card" : "Bank transfer";

  async function openPaystackCheckout() {
    if (!amountIsValid || pending) return;
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/wallet/topup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: effectiveAmount, method, ...(returnTo ? { returnTo } : {}) }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        authorizationUrl?: string;
      };

      if (!response.ok || !data.ok || !data.authorizationUrl) {
        setError(data.error ?? "We couldn't start the Paystack checkout. Please try again.");
        return;
      }

      const checkout = new URL(data.authorizationUrl);
      if (checkout.protocol !== "https:" || checkout.hostname !== "checkout.paystack.com") {
        setError("Paystack returned an unrecognized checkout address. No payment was started.");
        return;
      }
      window.location.assign(checkout.toString());
    } catch {
      setError("Network hiccup. No wallet credit was added. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (previewMode || !paystackReady) {
    return (
      <section className="pryva-funding-card">
        <div className="pryva-funding-heading">
          <div>
            <span className="pryva-section-eyebrow">WALLET FUNDING</span>
            <h2>{previewMode ? "Demo wallet" : "Add money to Pryva"}</h2>
            <p>Use your available balance to pay for service orders.</p>
          </div>
          <span className={`pryva-funding-badge ${previewMode ? "is-preview" : "is-unavailable"}`}>
            <i /> {previewMode ? "Read-only demo" : "Paystack not configured"}
          </span>
        </div>

        <div className="pryva-funding-balance">
          <span>{previewMode ? "Sample wallet balance" : "Available wallet balance"}</span>
          <strong>{formatNaira(balance)}</strong>
        </div>

        <div className="pryva-funding-state" role="status">
          <span className="pryva-funding-state-icon"><Lock className="h-4 w-4" /></span>
          <div>
            <strong>{previewMode ? "This preview cannot move money" : "Paystack setup is required"}</strong>
            <p>
              {previewMode
                ? "This is sample credit. No card or bank transfer is charged, and wallet funding is disabled in the demo."
                : "Wallet top-ups open Paystack when the server-side key and callback are ready. No payment or wallet credit happens here yet."}
            </p>
          </div>
        </div>

        <div className="pryva-funding-methods" aria-label="Payment methods unavailable">
          <div className="pryva-funding-method" aria-disabled="true">
            <span><Wallet className="h-4 w-4" /></span>
            <strong>Bank transfer</strong>
            <small>{previewMode ? "Demo disabled" : "Paystack setup needed"}</small>
          </div>
          <div className="pryva-funding-method" aria-disabled="true">
            <span><Card className="h-4 w-4" /></span>
            <strong>Local card</strong>
            <small>{previewMode ? "Demo disabled" : "Paystack setup needed"}</small>
          </div>
        </div>

        <div className="pryva-funding-footer">
          <span><Lock className="h-3.5 w-3.5" /> Purchases use only your existing Pryva wallet balance.</span>
          {previewMode ? (
            <Link href="/pricing" className="pryva-funding-link">
              Explore services <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : (
            <Link href="/dashboard/support" className="pryva-funding-link">
              Ask support <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="pryva-funding-card pryva-funding-active">
      {paymentResult && (
        <div className={`pryva-funding-result is-${paymentResult.status}`} role="status" aria-live="polite">
          <span className="pryva-funding-result-icon">
            {paymentResult.status === "paid" ? <Check className="h-4 w-4" /> : paymentResult.status === "pending" ? <Clock className="h-4 w-4" /> : <Refresh className="h-4 w-4" />}
          </span>
          <div>
            <strong>
              {paymentResult.status === "paid"
                ? `${formatNaira(paymentResult.amount)} added to your wallet`
                : paymentResult.status === "pending"
                  ? "Payment is still being verified"
                  : "Payment could not be confirmed"}
            </strong>
            <p>
              {paymentResult.status === "paid"
                ? "Paystack verified the transaction. Your updated balance is shown below."
                : paymentResult.status === "pending"
                  ? "No wallet credit is issued until Paystack confirms payment. Use Verify again to check its status."
                  : "Paystack did not confirm a valid payment for this top-up. No wallet credit was issued; contact support if your account was debited."}
            </p>
            <small>Reference · {paymentResult.reference}</small>
            {paymentResult.status === "paid" && returnTo && (
              <Link href={returnTo} className="pryva-funding-continue">
                Continue your order <ArrowRight className="h-3 w-3" />
              </Link>
            )}
          </div>
          {paymentResult.status === "pending" && (
            <button
              type="button"
              onClick={() => {
                const callback = new URL("/api/wallet/topup/callback", window.location.origin);
                callback.searchParams.set("reference", paymentResult.reference);
                if (returnTo) callback.searchParams.set("returnTo", returnTo);
                window.location.assign(callback.toString());
              }}
              aria-label="Verify payment again"
              title="Verify payment again"
            >
              <Refresh className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      <div className="pryva-funding-heading">
        <div>
          <span className="pryva-section-eyebrow">WALLET FUNDING</span>
          <h2>{step === "amount" ? "Add money to Pryva" : "Review top-up"}</h2>
          <p>{step === "amount" ? "Choose an amount and continue to Paystack's secure checkout." : "Check the amount and payment method before you continue."}</p>
        </div>
        <span className="pryva-funding-badge is-paystack"><i /> Paystack checkout</span>
      </div>

      <ol className="pryva-funding-stepper" aria-label="Top-up steps">
        <li className={step === "amount" ? "is-current" : "is-done"}><span>{step === "review" ? <Check className="h-3 w-3" /> : "01"}</span> Amount</li>
        <li className={step === "review" ? "is-current" : ""}><span>02</span> Review</li>
        <li><span>03</span> Paystack</li>
      </ol>

      {step === "amount" ? (
        <>
          <div>
            <p className="pryva-funding-field-label">Choose an amount</p>
            <div className="pryva-funding-presets">
              {presets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => { setAmount(preset); setCustom(""); setError(null); }}
                  className={!custom && amount === preset ? "is-selected" : ""}
                  aria-pressed={!custom && amount === preset}
                >
                  {formatNaira(preset)}
                </button>
              ))}
            </div>
          </div>

          <label className="pryva-funding-custom">
            <span className="pryva-funding-field-label">Or enter another amount</span>
            <span className="pryva-funding-input-wrap">
              <span>₦</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={custom}
                onChange={(event) => { setCustom(event.target.value.replace(/[^\d]/g, "")); setError(null); }}
                placeholder="e.g. 7,500"
                aria-label="Custom wallet top-up amount in naira"
              />
            </span>
            <small>Minimum ₦1,000 · maximum ₦500,000</small>
          </label>

          <div>
            <p className="pryva-funding-field-label">Payment method</p>
            <div className="pryva-funding-methods">
              <button
                type="button"
                onClick={() => setMethod("bank-transfer")}
                className={`pryva-funding-method ${method === "bank-transfer" ? "is-selected" : ""}`}
                aria-pressed={method === "bank-transfer"}
              >
                <span><Wallet className="h-4 w-4" /></span>
                <strong>Bank transfer</strong>
                <small>Paystack checkout</small>
                {method === "bank-transfer" && <Check className="pryva-funding-method-check h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => setMethod("card")}
                className={`pryva-funding-method ${method === "card" ? "is-selected" : ""}`}
                aria-pressed={method === "card"}
              >
                <span><Card className="h-4 w-4" /></span>
                <strong>Local card</strong>
                <small>Paystack checkout</small>
                {method === "card" && <Check className="pryva-funding-method-check h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {error && <p className="pryva-checkout-error" role="alert">{error}</p>}

          <div className="pryva-funding-footer">
            <span><Shield className="h-3.5 w-3.5" /> Wallet is credited only after Paystack verifies payment.</span>
            <button
              type="button"
              onClick={() => { setStep("review"); setError(null); }}
              disabled={!amountIsValid}
              className="pryva-checkout-primary"
            >
              Review top-up <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </>
      ) : (
        <>
          <button type="button" onClick={() => { setStep("amount"); setError(null); }} className="pryva-checkout-back">
            <ArrowLeft className="h-3.5 w-3.5" /> Edit amount
          </button>
          <dl className="pryva-funding-review">
            <div><dt>Top-up amount</dt><dd>{formatNaira(effectiveAmount)}</dd></div>
            <div><dt>Payment method</dt><dd>{methodLabel}</dd></div>
            <div><dt>Current wallet balance</dt><dd>{formatNaira(balance)}</dd></div>
            <div className="is-total"><dt>Balance after confirmation</dt><dd>{formatNaira(balance + effectiveAmount)}</dd></div>
          </dl>
          <div className="pryva-funding-state" role="note">
            <span className="pryva-funding-state-icon"><Shield className="h-4 w-4" /></span>
            <div>
              <strong>You&apos;ll pay on Paystack</strong>
              <p>Paystack may apply a checkout fee. Review the final payable amount there; Pryva verifies payment server-side and credits only this top-up amount to your wallet.</p>
            </div>
          </div>
          {error && <p className="pryva-checkout-error" role="alert">{error}</p>}
          <div className="pryva-funding-review-actions">
            <button type="button" onClick={() => { setStep("amount"); setError(null); }} className="pryva-checkout-secondary">
              Back
            </button>
            <button type="button" onClick={openPaystackCheckout} disabled={pending || !amountIsValid} className="pryva-checkout-primary">
              {pending ? "Opening Paystack…" : `Continue to Paystack · ${formatNaira(effectiveAmount)}`}
              {!pending && <Lock className="h-3.5 w-3.5" />}
            </button>
          </div>
        </>
      )}

      <p className="pryva-funding-footnote"><Lock className="h-3 w-3" /> Payment details are entered on Paystack, not stored by Pryva.</p>
    </section>
  );
}
