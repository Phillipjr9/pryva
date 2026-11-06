"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Download, FileJson, FileText, Refresh } from "@/components/icons";

export function RefreshButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const router = useRouter();
  return <div className="position-relative"><button type="button" className="btn btn-outline-secondary" disabled={pending} onClick={() => startTransition(() => { router.refresh(); setMessage("Dashboard refreshed"); })} aria-label="Refresh dashboard data"><Refresh className={pending ? "animate-spin" : ""} /><span className="d-none d-sm-inline">{pending ? "Refreshing…" : "Refresh"}</span></button><span className="visually-hidden" role="status">{message}</span></div>;
}

export function ExportMenu({ start, end }: { start: string; end: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function outside(event: PointerEvent) { if (!root.current?.contains(event.target as Node)) setOpen(false); }
    function escape(event: KeyboardEvent) { if (event.key === "Escape") setOpen(false); }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, []);
  const href = (format: "csv" | "json") => `/api/admin/export?${new URLSearchParams({ type: "orders", format, startDate: start, endDate: end })}`;
  return <div className="position-relative" ref={root}>
    <button type="button" className="btn btn-primary" aria-expanded={open} aria-controls="dashboard-export" onClick={() => setOpen((value) => !value)}><Download />Export orders<ChevronDown /></button>
    {open && <div className="header-popover" id="dashboard-export" style={{ width: 235 }}><div className="popover-heading">Orders in this reporting period</div><a className="popover-row" href={href("csv")} download onClick={() => setOpen(false)}><FileText />Download CSV</a><a className="popover-row" href={href("json")} download onClick={() => setOpen(false)}><FileJson />Download JSON</a></div>}
  </div>;
}
