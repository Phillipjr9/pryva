"use client";

import { useState } from "react";
import { Check } from "@/components/icons";

export function MarkAllReadButton() {
  const [pending, setPending] = useState(false);

  async function markAllRead() {
    setPending(true);
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
    } catch (error) {
      console.error("Failed to mark all as read:", error);
      setPending(false);
    }
  }

  return (
    <button
      onClick={markAllRead}
      disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3.5 py-2 text-[0.78rem] font-semibold text-ink-2 transition-colors hover:bg-cream disabled:opacity-60"
    >
      <Check className="h-3.5 w-3.5" />
      {pending ? "Marking…" : "Mark all read"}
    </button>
  );
}
