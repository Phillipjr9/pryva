"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/Toast";
import { Loader2 } from "@/components/icons";
import { isMessageStatus, MESSAGE_STATUS_LABELS as LABELS, MESSAGE_STATUSES, type MessageStatus } from "@/lib/support-messages";


/**
 * Status control for one support message.
 *
 * `/api/admin/messages` already accepted a PATCH; nothing in the product could
 * reach it, so every message submitted from /contact or /dashboard/support sat
 * in the table forever with no way to triage it.
 */
export function MessageStatusControl({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [next, setNext] = useState<MessageStatus>(isMessageStatus(status) ? status : "open");
  const [saving, setSaving] = useState(false);
  const unchanged = next === status;

  async function save() {
    setSaving(true);
    try {
      const response = await fetch("/api/admin/messages", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: id, status: next }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        toast.error(data.error ?? "Could not update that message.");
        return;
      }
      toast.success(`Marked as ${LABELS[next].toLowerCase()}.`);
      router.refresh();
    } catch {
      toast.error("Could not update that message.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor={`message-status-${id}`}>
        Status
      </label>
      <select
        id={`message-status-${id}`}
        value={next}
        onChange={(event) => setNext(event.target.value as MessageStatus)}
        disabled={saving}
        className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[0.78rem] text-ink outline-none focus:border-lav-400 disabled:opacity-60"
      >
        {MESSAGE_STATUSES.map((value) => (
          <option key={value} value={value}>
            {LABELS[value]}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || unchanged}
        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[0.76rem] font-semibold text-ink transition-colors hover:border-lav-300 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {saving && <Loader2 className="h-3 w-3 animate-spin" />}
        {saving ? "Saving…" : "Update"}
      </button>
    </div>
  );
}
