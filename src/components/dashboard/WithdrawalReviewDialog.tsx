"use client";

import { useEffect, useRef, useState } from "react";
import { formatNaira } from "@/lib/catalog";
import { maskAccountNumber, withdrawalStatusLabel, type WithdrawalReceipt, type WithdrawalSubmitResult } from "@/lib/withdrawal-receipt";
import { MoneyFlowDialog, MoneyOrbit, MoneyProcessing, MoneyResultIcon, MoneyRoute, downloadTextReceipt, moneyDate } from "./MoneyFlowDialog";
import styles from "./MoneyFlow.module.css";

export type WithdrawalReview = { amount: number; fee: number; bankAccountId: string; bankName: string; accountNumber: string; accountName: string };

/**
 * The customer's own confirmation of a payout that is about to be sent — not a
 * request for somebody else's approval, which no longer exists.
 */
export function WithdrawalReviewDialog({ review, onSubmit, onClose, testMode = false }: {
  review: WithdrawalReview; onSubmit: (review: WithdrawalReview) => Promise<WithdrawalSubmitResult>; onClose: () => void; testMode?: boolean;
}) {
  const [stage, setStage] = useState<"review" | "processing" | "done" | "unconfirmed">("review");
  const [receipt, setReceipt] = useState<WithdrawalReceipt | null>(null);
  const [error, setError] = useState("");
  const mounted = useRef(false);
  const sending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  async function confirm() {
    if (sending.current) return;
    sending.current = true;
    setStage("processing");
    // Start immediately; the animation is never allowed to substitute for an
    // actual response. A short minimum merely prevents a flickering dialog.
    const [outcome] = await Promise.all([onSubmit(review), new Promise<void>((resolve) => window.setTimeout(resolve, 800))]).catch(() => [{ ok: false, message: "The request outcome is unconfirmed. Review your requests or contact support before trying again." } as WithdrawalSubmitResult]);
    sending.current = false;
    if (!mounted.current) return;
    if (!outcome.ok) { setError(outcome.message); setStage("unconfirmed"); return; }
    setReceipt(outcome.receipt);
    setStage("done");
  }

  function receiptStatus(value: WithdrawalReceipt) {
    return testMode && value.status === "completed" ? "Marked complete (test)" : withdrawalStatusLabel(value.status);
  }

  function download() {
    if (!receipt) return;
    downloadTextReceipt(`pryva-withdrawal-receipt-${receipt.reference}.txt`, [
      testMode ? "PRYVA TEST PAYOUT RECEIPT — NOT A REAL PAYOUT" : "PRYVA PAYOUT RECEIPT",
      "======================================================",
      `Reference: ${receipt.reference}`,
      `Requested: ${moneyDate(receipt.createdAt)}`,
      `Status at receipt: ${receiptStatus(receipt)}`,
      `Bank: ${receipt.bankName}`,
      `Account: ${receipt.accountName} · ${maskAccountNumber(receipt.accountNumber)}`,
      `Requested payout: ${formatNaira(receipt.amount)}`,
      `Fee: ${formatNaira(receipt.fee)}`,
      `Wallet amount initially reserved: ${formatNaira(receipt.amount + receipt.fee)}`,
      ...(receipt.newBalance === undefined ? [] : [`Wallet balance after request: ${formatNaira(receipt.newBalance)}`]),
      testMode
        ? "Test mode: no real bank payout is made."
        : receipt.status === "failed" || receipt.status === "rejected"
          ? "The payout was not sent and the amount and fee were returned to the wallet."
          : "Sent is not settled: the status becomes Paid out when the bank confirms. Check Requests for the latest status.",
    ].join("\n"));
  }

  const refunded = receipt?.status === "failed" || receipt?.status === "rejected";
  const title = stage === "review"
    ? "Review your withdrawal"
    : stage === "processing"
      ? "Sending your payout"
      : stage === "done"
        ? (refunded ? "Payout not sent" : "Payout sent")
        : "Payout needs attention";
  return <MoneyFlowDialog stage={stage === "unconfirmed" ? "processing" : stage} title={title} onClose={onClose} canClose={stage !== "processing"} centered={stage !== "review"} lead={stage === "processing" ? <MoneyOrbit /> : stage === "done" ? <MoneyResultIcon /> : undefined}>
    {testMode && <p className={styles.notice}>PAYSTACK TEST MODE — this is not a real bank payout.</p>}
    {stage === "review" && <>
      <p className={styles.description}>Confirm the payout details. The transfer is sent as soon as you confirm.</p>
      <p className={styles.small}>The account name above is the name the withdrawal is paid into. It must be the name that funded this wallet — a payout to a third-party account is refused.</p>
      <div className={styles.amount}>{formatNaira(review.amount)}</div>
      <MoneyRoute from="Your wallet" fromNote="Funds reserved" to={review.bankName} toNote={maskAccountNumber(review.accountNumber)} />
      <div className={styles.summary}>
        <div className={styles.row}><span>Account name</span><strong>{review.accountName}</strong></div>
        <div className={styles.row}><span>Account</span><strong>{review.bankName} · {maskAccountNumber(review.accountNumber)}</strong></div>
        <div className={styles.row}><span>Bank payout requested</span><strong>{formatNaira(review.amount)}</strong></div>
        <div className={styles.row}><span>Withdrawal fee</span><strong>{formatNaira(review.fee)}</strong></div>
        <div className={`${styles.row} ${styles.rowTotal}`}><span>Wallet amount reserved</span><strong>{formatNaira(review.amount + review.fee)}</strong></div>
      </div>
      <p className={styles.hint} style={{ marginTop: 12 }}>The transfer is sent immediately after you confirm. It is not finished until your bank accepts it; if it fails, the amount and fee return to your wallet.</p>
      <div className={styles.actions}><button type="button" className={styles.button} onClick={onClose}>Edit</button><button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => void confirm()}>Send payout</button></div>
    </>}
    {stage === "processing" && <MoneyProcessing detail="Reserving the amount and sending the transfer." from="Your wallet" fromNote="Reserved" to="Bank account" toNote="Sending now" steps={["Withdrawal confirmed", "Wallet funds reserved", "Sending the transfer"]} />}
    {stage === "done" && receipt && <>
      <div className={styles.result}><strong className={styles.resultAmount}>{formatNaira(receipt.amount)}</strong><p className={styles.description}>
        {refunded
          ? "The payout could not be sent, so the amount and fee are back in your wallet."
          : "The payout was sent. It becomes Paid out once your bank confirms it."}
      </p></div>
      <div className={styles.receipt}>
        <div className={styles.row}><span>Status at receipt</span><strong>{receiptStatus(receipt)}</strong></div>
        <div className={styles.row}><span>Reference</span><strong>{receipt.reference}</strong></div>
        <div className={styles.row}><span>Requested</span><strong>{moneyDate(receipt.createdAt)}</strong></div>
        <div className={styles.row}><span>Destination</span><strong>{receipt.bankName} · {maskAccountNumber(receipt.accountNumber)} ({receipt.accountName})</strong></div>
        <div className={styles.row}><span>Fee</span><strong>{formatNaira(receipt.fee)}</strong></div>
        <div className={styles.row}><span>Wallet amount initially reserved</span><strong>{formatNaira(receipt.amount + receipt.fee)}</strong></div>
      </div>
      <p className={styles.small}>Check Requests for the latest status. A sent transfer is not settlement until the bank confirms it.</p>
      <div className={styles.actions}><button type="button" className={styles.button} onClick={download}>Download payout receipt</button><button type="button" className={`${styles.button} ${styles.primary}`} onClick={onClose}>View requests</button></div>
    </>}
    {stage === "unconfirmed" && <>
      <p role="alert" className={styles.description} style={{ textAlign: "center" }}>{error}</p>
      <p className={styles.small}>Do not submit a new withdrawal while this one is uncertain. Review Requests and retry only the original request ID, or contact support.</p>
      <div className={styles.actions}><button type="button" className={`${styles.button} ${styles.primary}`} onClick={onClose}>View requests</button></div>
    </>}
  </MoneyFlowDialog>;
}
