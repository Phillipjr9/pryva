"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { fireConfetti } from "@/components/ui/Confetti";
import { MoneyFlowDialog, MoneyOrbit, MoneyProcessing, MoneyResultIcon, downloadTextReceipt, moneyDate } from "@/components/dashboard/MoneyFlowDialog";
import { formatNaira } from "@/lib/catalog";
import { forgetPaystackTopUp, notifyPaystackTopUpsChanged } from "@/lib/paystack-topup-intent";
import styles from "@/components/dashboard/MoneyFlow.module.css";

type Receipt = { reference: string; amount: number; balanceAfter: number; creditedAt: string };
type State = "verifying" | "credited" | "pending" | "failed";

function confirmedReceipt(value: unknown, reference: string): Receipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const receipt = value as Record<string, unknown>;
  if (receipt.reference !== reference || typeof receipt.amount !== "number" || !Number.isSafeInteger(receipt.amount) || receipt.amount < 1_000 || receipt.amount > 500_000 ||
      typeof receipt.balanceAfter !== "number" || !Number.isSafeInteger(receipt.balanceAfter) || receipt.balanceAfter < 0 ||
      typeof receipt.creditedAt !== "string" || !Number.isFinite(Date.parse(receipt.creditedAt))) return null;
  return { reference, amount: receipt.amount, balanceAfter: receipt.balanceAfter, creditedAt: receipt.creditedAt };
}

/** The callback only starts verification; the committed wallet ledger gates the receipt. */
export function TopUpReturn({ status, reference, userId, testMode = false }: { status?: string; reference?: string; userId: string; testMode?: boolean }) {
  const router = useRouter();
  const active = status === "return" || status === "success"; // Accept links initialized by older versions too.
  const [state, setState] = useState<State>(reference ? "verifying" : "pending");
  const [message, setMessage] = useState(reference ? "" : "No payment reference was returned. Check your wallet history or contact support before paying again.");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [open, setOpen] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active || !reference) return;
    let cancelled = false;
    const abort = new AbortController();
    const timeout = window.setTimeout(() => abort.abort(), 20_000);
    async function verify() {
      setState("verifying");
      setMessage("");
      try {
        const response = await fetch("/api/wallet/topup/verify", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reference }), signal: abort.signal,
        });
        const data: unknown = await response.json();
        const result = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
        if (cancelled) return;
        const confirmed = confirmedReceipt(result.receipt, reference!);
        if (response.ok && result.ok === true && result.status === "completed" && confirmed &&
            (result.credited === true || (result.credited === false && result.reason === "already_credited"))) {
          setReceipt(confirmed);
          setState("credited");
          setMessage(testMode
            ? (result.credited === false ? "This test payment was already added to your staging wallet." : "Test payment confirmed and added to your staging wallet. No real payment was made.")
            : (result.credited === false ? "This payment was already added to your wallet." : "Payment confirmed and added to your wallet."));
          try { forgetPaystackTopUp(window.localStorage, userId, reference!); notifyPaystackTopUpsChanged(); } catch { /* Receipt is still valid; retain recovery state if it cannot be cleared. */ }
          fireConfetti();
        } else if (response.status === 402 && result.status === "failed") {
          setState("failed");
          setMessage(typeof result.error === "string" ? result.error : "Paystack reports this payment failed. Check your wallet history or contact support before paying again.");
        } else {
          setState("pending");
          setMessage(typeof result.message === "string" ? result.message : typeof result.error === "string" ? result.error : "We couldn't confirm the payment yet. Check your wallet history or contact support with the reference before paying again.");
        }
      } catch {
        if (!cancelled) {
          setState("pending");
          setMessage("We couldn't confirm the payment yet. Check your wallet history or contact support with the reference before paying again.");
        }
      } finally {
        window.clearTimeout(timeout);
        if (!cancelled) router.refresh();
      }
    }
    void verify();
    return () => { cancelled = true; abort.abort(); window.clearTimeout(timeout); };
  }, [active, reference, attempt, router, userId, testMode]);

  if (!active) return null;
  function close() {
    if (state === "credited") router.replace("/dashboard/wallet", { scroll: false });
    else setOpen(false);
  }
  function download() {
    if (!receipt) return;
    downloadTextReceipt(`pryva-topup-${receipt.reference}.txt`, [
      testMode ? "PRYVA TEST WALLET RECEIPT — NOT A REAL PAYMENT" : "PRYVA WALLET TOP-UP RECEIPT",
      "===========================",
      "Status: Credited to wallet",
      `Reference: ${receipt.reference}`,
      `Wallet credit recorded: ${moneyDate(receipt.creditedAt)}`,
      `Amount added: ${formatNaira(receipt.amount)}`,
      testMode ? "Payment: Paystack test checkout" : "Payment: Paystack checkout",
      `Wallet balance at credit: ${formatNaira(receipt.balanceAfter)}`,
      testMode ? "This is a test-mode wallet credit; no real payment was made." : "This confirms the wallet credit; it is not a bank or card statement.",
    ].join("\n"));
  }

  if (!open) return <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-lav-200 bg-lav-50 px-4 py-3 text-[0.8rem] text-lav-900">
    <span>{state === "credited" ? (testMode ? "Test payment confirmed and credited." : "Payment confirmed and credited.") : state === "verifying" ? "Payment verification is still in progress." : "Payment needs attention before paying again."}{reference ? ` Reference: ${reference}` : ""}</span>
    <button type="button" className="font-semibold underline" onClick={() => setOpen(true)}>{state === "credited" ? "View receipt" : "Review payment"}</button>
  </div>;

  const verifying = state === "verifying";
  const title = verifying ? "Confirming your payment" : state === "credited" ? (testMode ? "Test funds added to your wallet" : "Funds added to your wallet") : state === "failed" ? "Payment needs attention" : "Payment not confirmed yet";
  return <MoneyFlowDialog stage={state === "credited" ? "done" : "processing"} title={title} onClose={close} centered lead={verifying ? <MoneyOrbit /> : state === "credited" ? <MoneyResultIcon /> : undefined}>
    {testMode && <p className={styles.notice}>PAYSTACK TEST MODE — no real payment is made.</p>}
    {verifying && <>
      <MoneyProcessing detail="The return from checkout is not confirmation of payment." from="Paystack" fromNote="Payment status" to="Your wallet" toNote="Credit after confirmation" steps={["Payment reference received", "Verifying payment and wallet credit", "Receipt after confirmation"]} />
      {reference && <p className={styles.small}>Reference: {reference}</p>}
    </>}
    {state === "credited" && receipt && <>
      <div className={styles.result}><strong className={`${styles.resultAmount} ${styles.resultIn}`}>+{formatNaira(receipt.amount)}</strong><p className={styles.description}>{message}</p></div>
      <div className={styles.receipt}>
        <div className={styles.row}><span>Reference</span><strong>{receipt.reference}</strong></div>
        <div className={styles.row}><span>Wallet credit recorded</span><strong>{moneyDate(receipt.creditedAt)}</strong></div>
        <div className={styles.row}><span>Payment</span><strong>{testMode ? "Paystack test checkout" : "Paystack checkout"}</strong></div>
        <div className={styles.row}><span>Balance at credit</span><strong>{formatNaira(receipt.balanceAfter)}</strong></div>
      </div>
      <p className={styles.small}>{testMode ? "This is a test-mode wallet credit, not a real payment." : "This records the wallet credit, not a bank or card statement."} Your current balance may have changed.</p>
      <div className={styles.actions}><button type="button" className={styles.button} onClick={download}>Download receipt</button><button type="button" className={`${styles.button} ${styles.primary}`} onClick={close}>Done</button></div>
    </>}
    {(state === "pending" || state === "failed") && <>
      <p className={styles.description} role="alert" style={{ textAlign: "center" }}>{message}</p>
      {reference && <div className={styles.receipt}><div className={styles.row}><span>Reference</span><strong>{reference}</strong></div></div>}
      <p className={styles.small}>A new payment can be a separate charge. Keep this reference and check your wallet history or contact support before paying again.</p>
      <div className={styles.actions}><button type="button" className={styles.button} onClick={close}>Close</button>{reference && <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => { setState("verifying"); setAttempt((value) => value + 1); }}>Check again</button>}</div>
    </>}
  </MoneyFlowDialog>;
}
