"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Loader2, Send } from "@/components/icons";

/**
 * Replying on a ticket, or asking for a person.
 *
 * "Ask for a person" is a first-class button rather than an instruction hidden
 * in the copy: a customer who does not want to deal with an assistant should not
 * have to argue with it to get out.
 */
export function TicketReplyForm({ ticketId, closed }: { ticketId: string; closed: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<"reply" | "escalate" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (closed) {
    return (
      <p className="rounded-2xl border border-dashed border-line bg-cream/40 px-4 py-3 text-meta text-ink-3">
        This ticket is closed. Ask something new and it opens a fresh thread.
      </p>
    );
  }

  async function send(action: "reply" | "escalate") {
    if (pending) return;
    if (action === "reply" && message.trim().length < 2) return;
    setPending(action);
    setError(null);
    try {
      const response = await fetch(`/api/support/tickets/${ticketId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "reply" ? { message } : { action: "escalate" }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setError(data.error ?? "That didn't send. Please try again.");
        return;
      }
      if (action === "reply") setMessage("");
      router.refresh();
    } catch {
      setError("Network hiccup. Please try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send("reply");
        }}
      >
        <label htmlFor="ticket-reply" className="sr-only">
          Reply
        </label>
        <textarea
          id="ticket-reply"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={3}
          maxLength={8000}
          placeholder="Add anything that would help — a reference, an error message, what you expected."
          className="field w-full resize-y"
          disabled={pending !== null}
        />
        {error ? <p className="mt-2 text-[0.8rem] font-medium text-rose-700">{error}</p> : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={pending !== null || message.trim().length < 2}
            className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2 text-[0.82rem] font-semibold text-white hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending === "reply" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send
          </button>
          <button
            type="button"
            onClick={() => void send("escalate")}
            disabled={pending !== null}
            className="rounded-xl border border-line px-4 py-2 text-[0.82rem] font-semibold text-ink-2 hover:border-lav-300 disabled:opacity-50"
          >
            {pending === "escalate" ? "Passing it on…" : "Ask for a person instead"}
          </button>
        </div>
      </form>
    </div>
  );
}
