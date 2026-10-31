"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { SUPPORT_PRIORITIES, SUPPORT_STATUSES, SUPPORT_STATUS_LABELS } from "@/lib/ai-support/types";
import { Loader2 } from "@/components/icons";

/**
 * Reply, or move the ticket.
 *
 * The status control defaults to "resolved" because replying to a ticket is
 * normally the end of it, and an operator who forgets to change the state leaves
 * a queue that misreports itself. Choosing "escalated" deliberately keeps it in
 * the queue.
 */
export function AdminTicketControls({
  ticketId,
  status,
  priority,
}: {
  ticketId: string;
  status: string;
  priority: string;
}) {
  const router = useRouter();
  const [reply, setReply] = useState("");
  const [nextStatus, setNextStatus] = useState(status === "open" || status === "escalated" ? "resolved" : status);
  const [nextPriority, setNextPriority] = useState(priority);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(`/api/admin/support/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: nextStatus,
          priority: nextPriority,
          ...(reply.trim().length > 0 ? { reply } : {}),
        }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setError(data.error ?? "That did not save.");
        return;
      }
      setReply("");
      setSaved(true);
      router.refresh();
    } catch {
      setError("Network hiccup. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-4">
      <label htmlFor="admin-reply" className="text-[0.86rem] font-semibold text-ink">
        Reply on this ticket
      </label>
      <textarea
        id="admin-reply"
        value={reply}
        onChange={(event) => setReply(event.target.value)}
        rows={4}
        maxLength={8000}
        className="field mt-2 w-full resize-y"
        placeholder="What the customer should read. Leave empty to only change the state."
        disabled={pending}
      />

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-micro font-medium text-ink-2">
          Status
          <select
            value={nextStatus}
            onChange={(event) => setNextStatus(event.target.value)}
            className="field mt-1 w-full"
            disabled={pending}
          >
            {SUPPORT_STATUSES.map((option) => (
              <option key={option} value={option}>
                {SUPPORT_STATUS_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        <label className="text-micro font-medium text-ink-2">
          Priority
          <select
            value={nextPriority}
            onChange={(event) => setNextPriority(event.target.value)}
            className="field mt-1 w-full"
            disabled={pending}
          >
            {SUPPORT_PRIORITIES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? <p className="mt-2 text-[0.8rem] font-medium text-rose-700">{error}</p> : null}
      {saved ? <p className="mt-2 text-[0.8rem] font-medium text-emerald-700">Saved.</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-3 inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2 text-[0.82rem] font-semibold text-white hover:bg-ink-2 disabled:opacity-50"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {pending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
