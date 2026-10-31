"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/Toast";
import { Download, FileJson, FileText, Loader2 } from "@/components/icons";

/**
 * Export the wallet ledger as CSV or JSON.
 *
 * The endpoint (`/api/wallet/transactions/export`) existed with no way to reach
 * it, so the wallet showed up to 40 entries and offered no way to take the rest
 * away for reconciliation.
 */
export function ExportTransactionsButton() {
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function handleExport(format: "csv" | "json") {
    setExporting(true);
    setOpen(false);

    try {
      const response = await fetch(`/api/wallet/transactions/export?format=${format}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        toast.error(data?.error ?? "That export could not be prepared. Please try again.");
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `transactions-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success(`Transaction history is downloading as ${format.toUpperCase()}.`);
    } catch {
      toast.error("That export could not be prepared. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="relative" ref={root}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={exporting}
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-meta font-semibold text-ink-2 transition-colors hover:border-lav-300 hover:text-ink disabled:opacity-50"
      >
        {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        {exporting ? "Exporting…" : "Export"}
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 top-full z-20 mt-2 w-48 overflow-hidden rounded-xl border border-line bg-white shadow-[var(--shadow-card)]"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => void handleExport("csv")}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-[0.82rem] font-medium text-ink transition-colors hover:bg-cream"
            >
              <FileText className="h-4 w-4 text-ink-2" />
              Export as CSV
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => void handleExport("json")}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-[0.82rem] font-medium text-ink transition-colors hover:bg-cream"
            >
              <FileJson className="h-4 w-4 text-ink-2" />
              Export as JSON
            </button>
          </div>
        </>
      )}
    </div>
  );
}
