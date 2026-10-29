"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatNaira } from "@/lib/catalog";
import { isSafePaystackCheckoutUrl } from "@/lib/paystack-checkout";
import { navigateToPaystack } from "@/lib/paystack-navigate";
import { notifyPaystackTopUpsChanged, readPendingPaystackTopUps, rememberPaystackTopUp } from "@/lib/paystack-topup-intent";
import { MoneyFlowDialog, MoneyOrbit, MoneyProcessing, MoneyRoute } from "./MoneyFlowDialog";
import styles from "./MoneyFlow.module.css";

/** Real checkout is hosted by Paystack; no card data or PIN enters Pryva. */
export function PaystackTopUpFlow({ balance, userId, onClose, testMode = false }: { balance: number; userId: string; onClose: () => void; testMode?: boolean }) {
  const [stage, setStage] = useState<"details" | "review" | "processing">("details");
  const [amountText, setAmountText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [embedded, setEmbedded] = useState(false);
  const [returned, setReturned] = useState(false);
  const inFlight = useRef(false);
  const navigating = useRef(false);
  const mounted = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const amount = Number(amountText);
  const validAmount = /^\d+$/.test(amountText.trim()) && Number.isSafeInteger(amount) && amount >= 1_000 && amount <= 500_000;

  useEffect(() => {
    mounted.current = true;
    function pageShow(event: PageTransitionEvent) {
      if (event.persisted && navigating.current) {
        navigating.current = false;
        setCheckoutUrl(null);
        setReturned(true);
        notifyPaystackTopUpsChanged();
      }
    }
    window.addEventListener("pageshow", pageShow);
    return () => { mounted.current = false; controller.current?.abort(); window.removeEventListener("pageshow", pageShow); };
  }, []);

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validAmount) { setError("Enter a whole-naira amount between ₦1,000 and ₦500,000."); return; }
    setError(null);
    setStage("review");
  }

  async function openCheckout() {
    if (inFlight.current || !validAmount) return;
    try {
      if (readPendingPaystackTopUps(window.localStorage, userId).length) {
        setError("A previous payment needs attention. Close this dialog and check its reference before starting another.");
        notifyPaystackTopUpsChanged();
        return;
      }
    } catch {
      setError("Enable browser storage to safely keep your payment reference before opening checkout.");
      return;
    }
    inFlight.current = true;
    setError(null);
    setStage("processing");
    const abort = new AbortController();
    controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 20_000);
    try {
      const response = await fetch("/api/wallet/topup", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount }), signal: abort.signal,
      });
      const data: unknown = await response.json();
      const result = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
      if (!response.ok || result.ok !== true || !isSafePaystackCheckoutUrl(result.authorizationUrl) || typeof result.reference !== "string") {
        const message = typeof result.error === "string" && result.error.length <= 240 ? result.error : "Could not prepare a secure Paystack checkout.";
        throw new Error(message);
      }
      // A user never leaves for payment until their non-secret reference is
      // saved. Each reference has its own key; concurrent tabs cannot erase it.
      rememberPaystackTopUp(window.localStorage, userId, { reference: result.reference, amount });
      notifyPaystackTopUpsChanged();
      if (!mounted.current) return;
      setCheckoutUrl(result.authorizationUrl);
      navigating.current = true;
      // Hosted checkout can refuse framing. In an iframe, provide a user-clicked
      // top-level link instead of navigating the iframe into a blocked page.
      let insideFrame = false;
      try { insideFrame = window.self !== window.top; } catch { insideFrame = true; }
      setEmbedded(insideFrame);
      // Never derive success from this redirect. The return must be verified.
      if (!insideFrame) navigateToPaystack(result.authorizationUrl);
    } catch (reason) {
      if (!mounted.current) return;
      setStage("review");
      const message = reason instanceof Error && reason.name !== "AbortError" && reason.message.length <= 240 ? reason.message : "Could not open checkout.";
      setError(`${message} No payment was opened here. Check your wallet history before trying again.`);
    } finally {
      window.clearTimeout(timeout);
      controller.current = null;
      inFlight.current = false;
    }
  }

  const processing = stage === "processing";
  const title = stage === "details" ? "Add funds to your wallet" : stage === "review" ? "Review your top-up" : returned ? "Payment not confirmed yet" : "Opening Paystack checkout";
  return <MoneyFlowDialog stage={stage} title={title} onClose={onClose} canClose={!processing || Boolean(checkoutUrl) || returned} lead={processing && !returned ? <MoneyOrbit /> : undefined} centered={processing}>
    {testMode && <p className={styles.notice}>PAYSTACK TEST MODE — use test data; no real payment is made.</p>}
    {stage === "details" && <>
      <p className={styles.description}>Choose an amount, then review it before continuing to Paystack.</p>
      <form className={styles.form} onSubmit={review}>
        <label className={styles.field}>Amount (NGN)
          <input type="text" inputMode="numeric" autoComplete="off" value={amountText} onChange={(event) => { setAmountText(event.target.value); setError(null); }} placeholder="e.g. 5000" />
        </label>
        <div className={styles.presets}>{[2000, 5000, 10000, 25000, 50000].map((preset) => <button type="button" className={styles.preset} key={preset} onClick={() => { setAmountText(String(preset)); setError(null); }}>{formatNaira(preset)}</button>)}</div>
        <p className={styles.hint}>Minimum ₦1,000 · maximum ₦500,000 per top-up.</p>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <div className={styles.actions}><button type="submit" className={`${styles.button} ${styles.primary}`}>Review details</button></div>
      </form>
    </>}
    {stage === "review" && <>
      <p className={styles.description}>Check the amount before opening secure checkout.</p>
      <div className={styles.amount}>{formatNaira(amount)}</div>
      <MoneyRoute from="Paystack checkout" fromNote="Choose a payment method there" to="Your wallet" toNote="After confirmed payment" />
      <div className={styles.summary}>
        <div className={styles.row}><span>Amount to add</span><strong>{formatNaira(amount)}</strong></div>
        <div className={styles.row}><span>Payment method</span><strong>Choose in Paystack</strong></div>
        <div className={styles.row}><span>Charges</span><strong>Any applicable charges shown at checkout</strong></div>
        <div className={styles.row}><span>Current wallet balance</span><strong>{formatNaira(balance)}</strong></div>
      </div>
      <p className={styles.hint} style={{ marginTop: 12 }}>Paystack may ask for additional bank or card authentication. Your wallet is credited only after payment is confirmed.</p>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div className={styles.actions}><button type="button" className={styles.button} onClick={() => { setError(null); setStage("details"); }}>Edit</button><button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => void openCheckout()}>Continue to Paystack</button></div>
    </>}
    {processing && (returned ? <>
      <p className={styles.description} style={{ textAlign: "center" }}>You returned without a confirmed payment. Check the saved reference before paying again.</p>
      <div className={styles.actions}><button type="button" className={`${styles.button} ${styles.primary}`} onClick={onClose}>Check payment status</button></div>
    </> : <>
      <MoneyProcessing detail="Your wallet has not been charged or credited yet." from="Paystack checkout" fromNote="Secure checkout" to="Your wallet" toNote="After confirmation" current={checkoutUrl ? 2 : 1} steps={["Top-up details prepared", "Creating secure checkout", "Opening Paystack"]} />
      {checkoutUrl && <p className={styles.small}>{embedded ? "Paystack checkout needs to open outside this embedded view. " : "If checkout does not open, "}<a href={checkoutUrl} target="_top" className="font-semibold underline">continue to Paystack</a>. Completing checkout is not itself confirmation of a wallet credit.</p>}
    </>)}
  </MoneyFlowDialog>;
}
