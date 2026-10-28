"use client";

import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from "react";
import { Check, Wallet } from "@/components/icons";
import styles from "./DemoMoneyMovement.module.css";

export type MoneyFlowStage = "details" | "review" | "processing" | "done";

/** Shared accessible shell for the real-money review and confirmation flows. */
export function MoneyFlowDialog({ stage, title, onClose, canClose = true, lead, centered = false, children }: {
  stage: MoneyFlowStage;
  title: string;
  onClose: () => void;
  canClose?: boolean;
  lead?: ReactNode;
  centered?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const panel = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef(onClose);
  const canCloseRef = useRef(canClose);
  useEffect(() => { closeRef.current = onClose; canCloseRef.current = canClose; }, [onClose, canClose]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape" && canCloseRef.current) { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== "Tab" || !panel.current) return;
      const focusable = Array.from(panel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) { event.preventDefault(); panel.current.focus(); return; }
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !panel.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !panel.current.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); document.body.style.overflow = overflow; previous?.focus(); };
  }, []);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => heading.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [stage, title]);

  const rank = ["details", "review", "processing", "done"].indexOf(stage);
  return <div className={styles.backdrop} onMouseDown={(event) => { if (canClose && event.target === event.currentTarget) onClose(); }}>
    <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} ref={panel}>
      <div className={styles.inner}>
        <div className={styles.top}>
          <nav className={styles.steps} aria-label="Transaction progress">
            {["Details", "Review", "Processing", "Done"].map((label, index) => <span key={label} aria-current={index === rank ? "step" : undefined} className={`${styles.step} ${index < rank ? styles.stepDone : index === rank ? styles.stepActive : ""}`}><span className={styles.stepNumber}>{index < rank ? "✓" : index + 1}</span>{label}</span>)}
          </nav>
          <button type="button" className={styles.close} aria-label="Close transaction dialog" disabled={!canClose} onClick={onClose}>×</button>
        </div>
        {lead}
        <h2 id={id} ref={heading} tabIndex={-1} className={styles.title} style={centered ? { textAlign: "center" } : undefined}>{title}</h2>
        {children}
      </div>
    </section>
  </div>;
}

export function MoneyRoute({ from, fromNote, to, toNote, moving = false }: { from: string; fromNote: string; to: string; toNote: string; moving?: boolean }) {
  return <div className={`${styles.track} ${moving ? styles.moving : ""}`} aria-label={`${from} to ${to}`}>
    <div className={styles.party}><div className={styles.partyIcon}><Wallet /></div><div className={styles.partyName}>{from}</div><div className={styles.partySub}>{fromNote}</div></div>
    <div className={styles.route} aria-hidden="true"><span className={styles.routeArrow}>→</span></div>
    <div className={styles.party}><div className={styles.partyIcon}><Wallet /></div><div className={styles.partyName}>{to}</div><div className={styles.partySub}>{toNote}</div></div>
  </div>;
}

/** Indeterminate animation: only the first, actually completed step is checked. */
export function MoneyProcessing({ detail, from, fromNote, to, toNote, steps, current = 1 }: {
  detail: string; from: string; fromNote: string; to: string; toNote: string; steps: [string, string, string]; current?: 1 | 2;
}) {
  return <>
    <p className={styles.processingSub} style={{ textAlign: "center" }} role="status">{detail}</p>
    <MoneyRoute from={from} fromNote={fromNote} to={to} toNote={toNote} moving />
    <div className={`${styles.progress} ${styles.indeterminate}`} aria-hidden="true"><span /></div>
    <ul className={styles.list}>
      {steps.map((label, index) => <li key={label} className={`${styles.listItem} ${index < current ? styles.listDone : index === current ? styles.listCurrent : ""}`}>
        <span className={styles.listIcon} aria-hidden="true">{index < current ? "✓" : ""}</span>{label}
      </li>)}
    </ul>
  </>;
}

export function MoneyOrbit() {
  return <div className={styles.orbit} style={{ "--demo-progress": "45%" } as CSSProperties} aria-hidden="true"><span className={styles.orbitMark}><Wallet /></span></div>;
}

export function MoneyResultIcon() {
  return <div className={styles.resultIcon} aria-hidden="true"><Check /></div>;
}

export function downloadTextReceipt(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function moneyDate(value: string) {
  return new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}
