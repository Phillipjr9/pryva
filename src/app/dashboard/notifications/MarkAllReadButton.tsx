"use client";

import { useState } from "react";
import { Check } from "@/components/icons";

export function MarkAllReadButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function markAllRead() {
    setPending(true);
    setError("");
    try {
      const res = await fetch("/api/notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAll: true }),
      });

      if (!res.ok) {
        throw new Error("Failed to mark all as read");
      }

      // Reload the page to reflect changes
      window.location.reload();
    } catch {
      setError("Could not mark notifications as read. Please try again.");
      setPending(false);
    }
  }

  return (
    <div className="text-right">
      <button
        onClick={markAllRead}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3.5 py-2 text-[0.78rem] font-semibold text-ink-2 transition-colors hover:bg-cream disabled:opacity-60"
      >
        <Check className="h-3.5 w-3.5" />
        {pending ? "Marking…" : "Mark all read"}
      </button>
      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
