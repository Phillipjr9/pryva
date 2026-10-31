"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Loader2, Sparkle } from "@/components/icons";

/**
 * The box a customer writes into.
 *
 * One field, because the thing people hate about support forms is being asked to
 * categorise their own problem before anyone has read it. The category, the
 * priority and the first answer all come from the assistant reading the words.
 *
 * The reply is streamed back into the page rather than navigated to: if the
 * assistant fixed it, the customer sees that immediately, and if it did not, the
 * button to the thread is right there.
 */
export function SupportComposer({ examples }: { examples: string[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState<{ text: string; status: string; fixed: boolean } | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || message.trim().length < 2) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        ticketId?: string;
        reply?: string;
        status?: string;
        fixed?: boolean;
        error?: string;
      };
      if (!response.ok || !data.ok || !data.ticketId) {
        setError(data.error ?? "We couldn't send that. Please try again.");
        return;
      }
      setTicketId(data.ticketId);
      setReply({ text: data.reply ?? "", status: data.status ?? "open", fixed: Boolean(data.fixed) });
      setMessage("");
      router.refresh();
    } catch {
      setError("Network hiccup. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (reply) {
    return (
      <div className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-lav-100 text-lav-700">
            <Sparkle className="h-4 w-4" />
          </span>
          <p className="text-[0.9rem] font-semibold text-ink">
            {reply.fixed ? "Fixed — here is what happened" : "The assistant answered"}
          </p>
        </div>
        <div className="mt-3 whitespace-pre-line text-[0.86rem] leading-relaxed text-ink-2">{reply.text}</div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {ticketId ? (
            <a
              href={`/dashboard/support/${ticketId}`}
              className="rounded-xl bg-ink px-4 py-2 text-[0.82rem] font-semibold text-white hover:bg-ink-2"
            >
              Open the full thread
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setReply(null);
              setTicketId(null);
            }}
            className="rounded-xl border border-line px-4 py-2 text-[0.82rem] font-semibold text-ink-2 hover:border-lav-300"
          >
            Ask something else
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
      <label htmlFor="support-message" className="text-[0.9rem] font-semibold text-ink">
        What is going wrong?
      </label>
      <p className="mt-1 text-meta text-ink-3">
        Describe it the way you would to a person. The assistant reads it, checks your account and can fix most
        problems on the spot — and when it cannot, it says so and a person takes over.
      </p>
      <textarea
        id="support-message"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        rows={5}
        maxLength={8000}
        placeholder="e.g. I paid ₦5,000 an hour ago and my wallet is still empty."
        className="field mt-3 w-full resize-y"
        disabled={pending}
      />

      <div className="mt-3 flex flex-wrap gap-1.5">
        {examples.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => setMessage(example)}
            className="rounded-full border border-line bg-white px-2.5 py-1 text-micro text-ink-2 hover:border-lav-300 hover:text-lav-800"
          >
            {example}
          </button>
        ))}
      </div>

      {error ? <p className="mt-3 text-[0.8rem] font-medium text-rose-700">{error}</p> : null}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || message.trim().length < 2}
          className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2 text-[0.84rem] font-semibold text-white hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkle className="h-4 w-4" />}
          {pending ? "Looking at your account…" : "Ask the assistant"}
        </button>
        <span className="text-micro text-ink-3">Answers come from your own account records.</span>
      </div>
    </form>
  );
}
