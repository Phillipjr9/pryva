"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/Toast";
import { Download, FileJson, FileText, Loader2 } from "@/components/icons";

/**
 * Export the wallet ledger as CSV or JSON, for all time or for a chosen period.
 *
 * The endpoint (`/api/wallet/transactions/export`) existed with no way to reach
 * it, so the wallet showed up to 40 entries and offered no way to take the rest
 * away for reconciliation. The period is the second half of that: a customer
 * filing one month of returns should not have to download ten years and filter a
 * spreadsheet, and two exports of different months should not arrive with the
 * same filename.
 *
 * The dates are plain `YYYY-MM-DD` and are interpreted as whole days in Lagos by
 * the server. Empty means unbounded, so the button still does exactly what it did
 * before for anyone who never touches them.
 */
export function ExportTransactionsButton() {
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Caught here as well as on the server so an impossible period explains itself
  // without a round trip; the server stays the authority.
  const rangeProblem =
    startDate && endDate && startDate > endDate ? "The start date is after the end date." : null;

  async function handleExport(format: "csv" | "json") {
    if (rangeProblem) {
      setError(rangeProblem);
      return;
    }
    setError(null);
    setExporting(true);
    setOpen(false);

    try {
      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      const period = params.toString();

      const response = await fetch(
        `/api/wallet/transactions/export?format=${format}${period ? `&${period}` : ""}`,
        { cache: "no-store" },
      );

      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null;
        toast.error(data?.error ?? "That export could not be prepared. Please try again.");
        return;
      }

      const suffix = startDate && endDate
        ? `${startDate}_to_${endDate}`
        : startDate
          ? `from_${startDate}`
          : endDate
            ? `to_${endDate}`
            : "";

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `transactions-${new Date().toISOString().slice(0, 10)}${suffix ? `_${suffix}` : ""}.${format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success(
        `Transaction history is downloading as ${format.toUpperCase()}${startDate || endDate ? " for the period you chose" : ""}.`,
      );
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
        aria-haspopup="dialog"
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
            role="dialog"
            aria-label="Export transaction history"
            className="absolute right-0 top-full z-20 mt-2 w-64 overflow-hidden rounded-xl border border-line bg-white shadow-[var(--shadow-card)] sm:w-72"
          >
            <div className="border-b border-line px-4 py-3">
              <p className="text-meta font-semibold text-ink">Period</p>
              <p className="mt-0.5 text-meta leading-relaxed text-ink-3">
                Whole days, Lagos time. Leave both empty for your full history.
              </p>
              <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="block">
                  <span className="text-meta font-medium text-ink-2">From</span>
                  <input
                    type="date"
                    value={startDate}
                    max={endDate || undefined}
                    onChange={(event) => { setStartDate(event.target.value); setError(null); }}
                    className="mt-1 w-full rounded-lg border border-line bg-white px-2 py-1.5 text-meta text-ink outline-none focus:border-lav-300"
                  />
                </label>
                <label className="block">
                  <span className="text-meta font-medium text-ink-2">To</span>
                  <input
                    type="date"
                    value={endDate}
                    min={startDate || undefined}
                    onChange={(event) => { setEndDate(event.target.value); setError(null); }}
                    className="mt-1 w-full rounded-lg border border-line bg-white px-2 py-1.5 text-meta text-ink outline-none focus:border-lav-300"
                  />
                </label>
              </div>
              {(error ?? rangeProblem) && (
                <p role="alert" className="mt-2 text-meta text-red-600">
                  {error ?? rangeProblem}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => void handleExport("csv")}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-[0.82rem] font-medium text-ink transition-colors hover:bg-cream"
            >
              <FileText className="h-4 w-4 text-ink-2" />
              Export as CSV
            </button>
            <button
              type="button"
              onClick={() => void handleExport("json")}
              className="flex w-full items-center gap-3 border-t border-line px-4 py-3 text-left text-[0.82rem] font-medium text-ink transition-colors hover:bg-cream"
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
