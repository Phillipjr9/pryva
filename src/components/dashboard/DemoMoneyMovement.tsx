"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { ArrowUpRight, Card, Check, Wallet } from "@/components/icons";
import { fireConfetti } from "@/components/ui/Confetti";
import { formatNaira } from "@/lib/catalog";
import { demoMoneyStorageKey, parseDemoMoneyIntent, type DemoMoneyIntent, type DemoMoneyKind, type DemoMoneyMethod } from "@/lib/demo-money-intent";
import { MAX_WITHDRAWAL, MIN_WITHDRAWAL, maxWithdrawalForBalance, withdrawalFee } from "@/lib/withdrawal";
import styles from "./DemoMoneyMovement.module.css";

type Stage = "details" | "review" | "processing" | "done";
type DemoReceipt = { reference: string; balance: number; fee: number; confirmedAt: number };
type Outcome = { ok: true; receipt: DemoReceipt } | { ok: false; message: string; retrySame: boolean };

const PROCESSING_MS = 740;
const PRESENTATION_MS = PROCESSING_MS * 4 + 350;
const PROCESSING_STEPS = ["Preparing demo details", "Simulating the transaction", "Confirming the wallet update"];

function readSavedIntent(key: string, kind: DemoMoneyKind) {
  try { return parseDemoMoneyIntent(window.sessionStorage.getItem(key), kind); }
  catch { return null; }
}
function saveIntent(key: string, intent: DemoMoneyIntent) {
  try { window.sessionStorage.setItem(key, JSON.stringify(intent)); return true; }
  catch { return false; }
}
function clearIntent(key: string) {
  try { window.sessionStorage.removeItem(key); } catch { /* The in-memory key is still cleared. */ }
}
function wait(ms: number) { return new Promise<void>((resolve) => window.setTimeout(resolve, ms)); }
function methodLabel(method: DemoMoneyMethod) {
  return method === "card" ? "Demo card" : method === "bank-transfer" ? "Demo bank transfer" : "Demo transfer";
}
function dateLabel(value: number) {
  return new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

/**
 * Pryva's preview-only adaptation of the review/processing/receipt flow.
 * It changes the in-memory demo wallet through the existing guarded APIs; it
 * never asks for a PIN, a real destination, or payment details.
 */
export function DemoMoneyMovement({ kind, balance, userId, onClose, onCompleted }: {
  kind: DemoMoneyKind;
  balance: number;
  userId: string;
  onClose: () => void;
  onCompleted: () => void;
}) {
  const headingId = useId();
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const stageRef = useRef<Stage>("details");
  const closeRef = useRef(onClose);
  const mounted = useRef(false);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const storageKey = demoMoneyStorageKey(userId, kind);
  // This component only mounts after a client-side button click.
  const [saved] = useState(() => typeof window === "undefined" ? null : readSavedIntent(storageKey, kind));
  const attempt = useRef<DemoMoneyIntent | null>(saved);
  const [stage, setStage] = useState<Stage>(saved ? "review" : "details");
  const [amountText, setAmountText] = useState(saved ? String(saved.amount) : "");
  const [method, setMethod] = useState<DemoMoneyMethod>(saved?.method ?? (kind === "add" ? "bank-transfer" : "demo-transfer"));
  const [error, setError] = useState<string | null>(saved ? "A previous demo request is unconfirmed. Retry the same request or check your wallet history before starting another." : null);
  const [recovery, setRecovery] = useState(Boolean(saved));
  const [stepIndex, setStepIndex] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [receipt, setReceipt] = useState<DemoReceipt | null>(null);

  const amount = Number(amountText);
  const min = MIN_WITHDRAWAL;
  const max = kind === "add" ? 500_000 : MAX_WITHDRAWAL;
  const validAmount = /^\d+$/.test(amountText.trim()) && Number.isSafeInteger(amount) && amount >= min && amount <= max;
  const fee = kind === "send" && validAmount ? withdrawalFee(amount) : 0;
  const enoughBalance = kind === "add" || (validAmount && amount + fee <= balance);
  const estimatedBalance = kind === "add" ? balance + amount : balance - amount - fee;
  const maxPayout = maxWithdrawalForBalance(balance);
  const progress = Math.min(75, Math.round((stepIndex / (PROCESSING_STEPS.length - 1)) * 75));

  useEffect(() => { stageRef.current = stage; closeRef.current = onClose; }, [stage, onClose]);
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && stageRef.current !== "processing") { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== "Tab" || !panel.current) return;
      const focusable = Array.from(panel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (focusable.length === 0) { event.preventDefault(); panel.current.focus(); return; }
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      mounted.current = false;
      controller.current?.abort();
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => heading.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [stage]);
  useEffect(() => {
    if (stage !== "processing") return;
    const timer = window.setInterval(() => setStepIndex((current) => Math.min(current + 1, PROCESSING_STEPS.length - 1)), PROCESSING_MS);
    return () => window.clearInterval(timer);
  }, [stage]);
  useEffect(() => { if (receipt) fireConfetti(); }, [receipt]);

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validAmount) { setError(`Enter a whole-naira amount from ${formatNaira(min)} to ${formatNaira(max)}.`); return; }
    if (!enoughBalance) { setError("Your demo balance is too low for this amount and fee."); return; }
    setError(null);
    setStage("review");
  }

  async function sendRequest(intent: DemoMoneyIntent, signal: AbortSignal): Promise<Outcome> {
    try {
      const body = intent.kind === "add"
        ? { amount: intent.amount, method: intent.method, requestId: intent.requestId }
        : { amount: intent.amount, requestId: intent.requestId };
      const response = await fetch(intent.kind === "add" ? "/api/demo/wallet/topup" : "/api/demo/wallet/withdraw", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal,
      });
      const data: unknown = await response.json();
      const result = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
      if (!response.ok) {
        const message = typeof result.error === "string" && result.error.length <= 240 ? result.error : "Could not complete the demo request.";
        // Authentication/rate limits and server failures don't tell us whether
        // an earlier attempt with this key committed; preserve the same key.
        return { ok: false, message, retrySame: response.status === 401 || response.status === 429 || response.status >= 500 };
      }
      if (result.ok !== true || result.simulated !== true || result.amount !== intent.amount || typeof result.reference !== "string" || !result.reference || result.reference.length > 100 || typeof result.balance !== "number" || !Number.isSafeInteger(result.balance) || result.balance < 0 || typeof result.fee !== "number" || !Number.isSafeInteger(result.fee) || result.fee < 0) {
        return { ok: false, message: "The demo response could not be confirmed.", retrySame: true };
      }
      return { ok: true, receipt: { reference: result.reference, balance: result.balance, fee: result.fee, confirmedAt: Date.now() } };
    } catch {
      return { ok: false, message: "Could not confirm the demo request.", retrySame: true };
    }
  }

  async function confirm() {
    if (inFlight.current || !validAmount || (!recovery && !enoughBalance)) return;
    let intent = attempt.current;
    if (intent && (intent.kind !== kind || intent.amount !== amount || intent.method !== method)) {
      setError("Retry the original demo request or check your wallet history first.");
      setRecovery(true);
      return;
    }
    if (!intent) {
      if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") { setError("This browser cannot create a safe demo request. Please try a current browser."); return; }
      intent = { kind, amount, method, requestId: crypto.randomUUID() };
      attempt.current = intent;
    }
    if (!saveIntent(storageKey, intent)) {
      // Without a retry key across reloads we cannot safely distinguish an
      // interrupted request from one that already updated the wallet.
      if (!recovery) attempt.current = null;
      setError("Enable browser session storage to safely confirm a demo payment.");
      return;
    }
    inFlight.current = true;
    setError(null);
    setWaiting(false);
    setStepIndex(0);
    setStage("processing");
    const abort = new AbortController();
    controller.current = abort;
    const timeout = window.setTimeout(() => abort.abort(), 20_000);
    let settled = false;
    // Start the API request immediately; the minimum animation is visual only.
    const operation = sendRequest(intent, abort.signal).then((value) => { settled = true; return value; });
    await wait(PRESENTATION_MS);
    if (mounted.current && !settled) setWaiting(true);
    const outcome = await operation;
    window.clearTimeout(timeout);
    inFlight.current = false;
    controller.current = null;
    if (!mounted.current) return;
    setWaiting(false);
    if (!outcome.ok) {
      if (!outcome.retrySame) { clearIntent(storageKey); attempt.current = null; }
      setRecovery(outcome.retrySame);
      setError(outcome.retrySame ? `${outcome.message} Retry this same request or check your wallet history.` : outcome.message);
      setStage("review");
      return;
    }
    clearIntent(storageKey);
    attempt.current = null;
    setRecovery(false);
    setReceipt(outcome.receipt);
    setStage("done");
    onCompleted();
  }

  function restart() {
    setAmountText("");
    setMethod(kind === "add" ? "bank-transfer" : "demo-transfer");
    setReceipt(null);
    setError(null);
    setStage("details");
  }

  function downloadReceipt() {
    if (!receipt) return;
    const content = [
      "PRYVA DEMO WALLET RECEIPT — NOT A REAL PAYMENT",
      "========================================",
      `Reference: ${receipt.reference}`,
      `Confirmed: ${dateLabel(receipt.confirmedAt)}`,
      `${kind === "add" ? "Demo funds added" : "Demo funds sent"}: ${formatNaira(amount)}`,
      `${kind === "add" ? "Method" : "Destination"}: ${kind === "add" ? methodLabel(method) : "Fictional demo destination"}`,
      `Demo fee: ${formatNaira(receipt.fee)}`,
      `Demo wallet at confirmation: ${formatNaira(receipt.balance)}`,
      "No real money was moved.",
    ].join("\n");
    const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `pryva-demo-${receipt.reference}.txt`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const rank = stage === "review" ? 0 : stage === "processing" ? 1 : 2;
  const source = kind === "add" ? methodLabel(method) : "Your demo wallet";
  const destination = kind === "add" ? "Your demo wallet" : "Demo destination";
  const sourceNote = kind === "add" ? "Fictional source" : "Demo balance";
  const destinationNote = kind === "add" ? "Demo balance" : "Fictional recipient";
  const headingText = stage === "details" ? (kind === "add" ? "Add demo funds" : "Send demo funds")
    : stage === "review" ? (kind === "add" ? "Review demo top-up" : "Review demo transfer")
      : stage === "processing" ? (waiting ? "Waiting for confirmation…" : kind === "add" ? "Adding demo funds" : "Sending demo funds")
        : kind === "add" ? "Demo funds added" : "Demo transfer complete";

  return (
    <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget && stage !== "processing") onClose(); }}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={headingId} tabIndex={-1} ref={panel}>
        <div className={styles.inner}>
          <div className={styles.top}>
            {stage === "details" ? <p className={styles.eyebrow}>{kind === "add" ? "Move demo money in" : "Move demo money"}</p> : (
              <nav className={styles.steps} aria-label="Transaction progress">
                {["Review", "Processing", "Done"].map((label, index) => (
                  <span key={label} aria-current={index === rank ? "step" : undefined} className={`${styles.step} ${index < rank ? styles.stepDone : index === rank ? styles.stepActive : ""}`}>
                    <span className={styles.stepNumber}>{index < rank ? "✓" : index + 1}</span>{label}
                  </span>
                ))}
              </nav>
            )}
            <button type="button" className={styles.close} aria-label="Close transaction dialog" disabled={stage === "processing"} onClick={onClose}>×</button>
          </div>
          <p className={styles.demo}>DEMO ONLY — your demo wallet changes, but no real money moves.</p>

          {stage === "details" && <>
            <h2 className={styles.title} id={headingId} tabIndex={-1} ref={heading}>{headingText}</h2>
            <p className={styles.description}>{kind === "add" ? "Choose a source and amount, then review before confirming." : "Choose an amount to send to a fictional demo destination."}</p>
            <form className={styles.form} onSubmit={review}>
              {kind === "add" ? <label className={styles.field}>Funding method
                <select value={method} onChange={(event) => { setMethod(event.target.value as DemoMoneyMethod); setError(null); }}>
                  <option value="bank-transfer">Demo bank transfer</option><option value="card">Demo card</option>
                </select>
              </label> : <div className={styles.destination}><strong>Fictional demo destination</strong>No bank details are collected and no transfer is sent.</div>}
              <label className={styles.field}>Amount (NGN)
                <input type="text" inputMode="numeric" value={amountText} onChange={(event) => { setAmountText(event.target.value); setError(null); }} placeholder="0" autoComplete="off" required />
              </label>
              <div className={styles.presets} aria-label="Suggested amounts">
                {(kind === "add" ? [2000, 5000, 10000, 25000] : [1000, 5000, 10000].filter((value) => value <= maxPayout)).map((value) => <button key={value} type="button" className={styles.preset} onClick={() => { setAmountText(String(value)); setError(null); }}>{formatNaira(value)}</button>)}
                {kind === "send" && maxPayout >= min && <button type="button" className={styles.preset} onClick={() => { setAmountText(String(maxPayout)); setError(null); }}>Max {formatNaira(maxPayout)}</button>}
              </div>
              <p className={styles.hint}>Enter {formatNaira(min)}–{formatNaira(max)} in whole naira.{kind === "send" ? ` Available demo balance: ${formatNaira(balance)}.` : ""}</p>
              {kind === "send" && validAmount && <p className={styles.hint}>Demo fee {formatNaira(fee)} · Wallet deduction {formatNaira(amount + fee)}</p>}
              {error && <p className={styles.error} role="alert">{error}</p>}
              <div className={styles.actions}><button type="button" className={styles.button} onClick={onClose}>Cancel</button><button type="submit" className={`${styles.button} ${styles.primary}`}>Review details</button></div>
            </form>
          </>}

          {(stage === "review" || stage === "processing") && <>
            {stage === "review" ? <>
              <h2 className={styles.title} id={headingId} tabIndex={-1} ref={heading}>{headingText}</h2>
              <p className={styles.description}>Check the details before confirming your simulated {kind === "add" ? "top-up" : "transfer"}.</p>
              <div className={styles.amount}>{formatNaira(amount)}</div>
            </> : <div className={styles.processingHead} role="status" aria-live="polite">
              <div className={styles.orbit} style={{ "--demo-progress": `${progress}%` } as CSSProperties} aria-hidden="true"><span className={styles.orbitMark}>{kind === "add" ? <Wallet /> : <ArrowUpRight />}</span></div>
              <h2 className={styles.title} id={headingId} tabIndex={-1} ref={heading}>{headingText}</h2>
              <p className={styles.processingSub}><strong>{formatNaira(amount)}</strong> · Demo transaction</p>
            </div>}
            <div className={styles.track} aria-label={`${source} to ${destination}`}>
              <div className={styles.party}><span className={styles.partyIcon} aria-hidden="true">{kind === "add" ? <Card /> : <Wallet />}</span><div className={styles.partyName}>{source}</div><div className={styles.partySub}>{sourceNote}</div></div>
              <div className={`${styles.route} ${stage === "processing" ? styles.moving : ""}`} aria-hidden="true"><span className={styles.routeArrow}>→</span></div>
              <div className={styles.party}><span className={styles.partyIcon} aria-hidden="true">{kind === "add" ? <Wallet /> : <ArrowUpRight />}</span><div className={styles.partyName}>{destination}</div><div className={styles.partySub}>{destinationNote}</div></div>
            </div>
            {stage === "review" ? <>
              <div className={styles.summary}>
                <div className={styles.row}><span>Method</span><strong>{methodLabel(method)}</strong></div>
                <div className={styles.row}><span>To</span><strong>{destination}</strong></div>
                <div className={styles.row}><span>Demo fee</span><strong>{formatNaira(fee)}</strong></div>
                <div className={`${styles.row} ${styles.rowTotal}`}><span>Estimated demo balance</span><strong>{recovery ? "Shown after confirmation" : formatNaira(estimatedBalance)}</strong></div>
              </div>
              <p className={styles.hint}>Your demo balance may change before confirmation.</p>
              {error && <p className={styles.error} role="alert">{error}</p>}
              <div className={styles.actions}>
                <button type="button" className={styles.button} disabled={recovery} onClick={() => { setError(null); setStage("details"); }}>Edit</button>
                <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => void confirm()}>{recovery ? "Retry same request" : kind === "add" ? `Add ${formatNaira(amount)}` : `Send ${formatNaira(amount)}`}</button>
              </div>
            </> : <>
              <div className={styles.progress} aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
              <ul className={styles.list} aria-label="Demo processing animation">
                {PROCESSING_STEPS.map((label, index) => <li key={label} className={`${styles.listItem} ${index < stepIndex ? styles.listDone : index === stepIndex ? styles.listCurrent : ""}`}><span className={styles.listIcon} aria-hidden="true">{index < stepIndex ? "✓" : ""}</span>{label}</li>)}
              </ul>
              <p className={styles.small}>The animation is illustrative. The receipt appears only after confirmation.</p>
            </>}
          </>}

          {stage === "done" && receipt && <>
            <div className={styles.result}>
              <div className={styles.resultIcon} aria-hidden="true"><Check /></div>
              <h2 className={styles.title} id={headingId} tabIndex={-1} ref={heading}>{headingText}</h2>
              <strong className={`${styles.resultAmount} ${kind === "add" ? styles.resultIn : ""}`}>{kind === "add" ? "+" : "−"}{formatNaira(amount)}</strong>
              <p className={styles.description}>Your demo wallet was updated. No real payment was made.</p>
            </div>
            <div className={styles.receipt}>
              <div className={styles.row}><span>Reference</span><strong>{receipt.reference}</strong></div>
              <div className={styles.row}><span>Confirmed</span><strong>{dateLabel(receipt.confirmedAt)}</strong></div>
              <div className={styles.row}><span>{kind === "add" ? "From" : "To"}</span><strong>{kind === "add" ? source : destination}</strong></div>
              <div className={styles.row}><span>Status</span><strong>Demo complete</strong></div>
              <div className={styles.row}><span>Demo fee</span><strong>{formatNaira(receipt.fee)}</strong></div>
              <div className={`${styles.row} ${styles.rowTotal}`}><span>Demo wallet at confirmation</span><strong>{formatNaira(receipt.balance)}</strong></div>
            </div>
            <p className={styles.small}>Simulation only: this receipt is not proof of a real payment.</p>
            <div className={styles.actions}>
              <button type="button" className={styles.button} onClick={downloadReceipt}>↓ Receipt</button>
              <button type="button" className={styles.button} onClick={restart}>{kind === "add" ? "Add more" : "Send another"}</button>
              <button type="button" className={`${styles.button} ${styles.primary}`} onClick={onClose}>Done</button>
            </div>
          </>}
        </div>
      </section>
    </div>
  );
}
