"use client";

import { useState } from "react";
import { Download, FileText, FileJson } from "@/components/icons";

export function ExportTransactionsButton() {
  const [exporting, setExporting] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  async function handleExport(format: "csv" | "json") {
    setExporting(true);
    setShowMenu(false);

    try {
      const response = await fetch(`/api/wallet/transactions/export?format=${format}`);
      
      if (!response.ok) {
        throw new Error("Export failed");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `transactions-${new Date().toISOString().split("T")[0]}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Export failed:", error);
      alert("Failed to export transactions. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setShowMenu(!showMenu)}
        disabled={exporting}
        className="flex items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-[0.86rem] font-medium text-ink transition-colors hover:bg-cream disabled:opacity-50 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-700"
      >
        <Download className="h-4 w-4" />
        {exporting ? "Exporting..." : "Export"}
      </button>

      {showMenu && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
          <div className="absolute right-0 top-full z-20 mt-2 w-48 rounded-xl border border-line bg-white shadow-[var(--shadow-card)] dark:bg-gray-900 dark:border-gray-700">
            <button
              onClick={() => handleExport("csv")}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-[0.86rem] font-medium text-ink transition-colors hover:bg-cream dark:text-gray-100 dark:hover:bg-gray-800"
            >
              <FileText className="h-4 w-4 text-ink-2 dark:text-gray-400" />
              Export as CSV
            </button>
            <button
              onClick={() => handleExport("json")}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-[0.86rem] font-medium text-ink transition-colors hover:bg-cream dark:text-gray-100 dark:hover:bg-gray-800"
            >
              <FileJson className="h-4 w-4 text-ink-2 dark:text-gray-400" />
              Export as JSON
            </button>
          </div>
        </>
      )}
    </div>
  );
}
