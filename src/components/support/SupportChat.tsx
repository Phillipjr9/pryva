"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { AssistantPresence, type PresenceState } from "@/components/support/AssistantPresence";
import { SupportStatusPill } from "@/components/support/SupportStatusPill";
import { AlertCircle, Loader2, Send, Sparkle, User } from "@/components/icons";

/**
 * The support conversation.
 *
 * It used to be a form that answered once and replaced itself. Pressing "Ask
 * something else" threw the exchange away, a follow-up had nowhere to go, and on a
 * ticket the reply only appeared after a server refresh — so the honest reading of
 * that screen was "the assistant is not interacting with me".
 *
 * This is a transcript that stays: what you typed appears immediately, the
 * assistant's answer lands underneath it, and the next question is a message in the
 * same conversation. Both entry points use it — the empty one on `/dashboard/support`
 * and the seeded one on a ticket — because two implementations of the same
 * conversation is how one of them ends up silent again.
 *
 * What it deliberately does not do: invent an answer. If the engine cannot tell
 * what is wrong, the reply says so and the thread is handed to a person; the chat
 * shows that sentence as it was written.
 */

export type ChatRole = "customer" | "assistant" | "admin" | "system";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  body: string;
  createdAt: string;
  /** An optimistic bubble that has not been confirmed by the server yet. */
  pending?: boolean;
};

type Reply = {
  ok?: boolean;
  ticketId?: string;
  reply?: string | null;
  status?: string;
  outcome?: string;
  fixed?: boolean;
  error?: string;
};

const BUBBLE_BASE = "w-full max-w-[46rem] rounded-2xl px-4 py-3";

/**
 * A question carried in the URL fragment, e.g. `/dashboard/support#ask=…`.
 *
 * The fragment deliberately is not a query parameter: the support page reads
 * the customer's tickets from the session, and a query parameter on that page
 * is how a crafted link ends up selecting somebody else's data. A fragment is
 * never sent to the server, so the worst it can do is prefill this composer —
 * nothing leaves the browser until the customer presses send.
 */
export function draftFromHash(hash: string): string {
  if (!hash.startsWith("#ask=")) return "";
  try {
    return decodeURIComponent(hash.slice(5)).trim().slice(0, 200);
  } catch {
    return "";
  }
}

function localMessage(role: ChatRole, body: string): ChatMessage {
  return {
    id: `local-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    body,
    createdAt: new Date().toISOString(),
  };
}

function timeOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Bubble({ message }: { message: ChatMessage }) {
  const mine = message.role === "customer";
  const assistant = message.role === "assistant";
  const admin = message.role === "admin";

  if (message.role === "system") {
    return (
      <p className="mx-auto max-w-[46rem] rounded-xl border border-dashed border-line bg-cream/50 px-3 py-2 text-center text-meta text-ink-2">
        {message.body}
      </p>
    );
  }

  return (
    <div
      className={`${BUBBLE_BASE} ${
        mine
          ? "ml-auto rounded-br-md bg-ink text-white"
          : assistant
            ? "mr-auto rounded-bl-md border border-lav-200 bg-lav-50/60"
            : "mr-auto rounded-bl-md border border-line bg-[#fffdfa]"
      }`}
    >
      <div className="flex items-center gap-1.5">
        {assistant ? (
          <>
            <Sparkle className="h-3.5 w-3.5 text-lav-700" />
            <span className="text-micro font-semibold text-lav-800">Pryva assistant</span>
          </>
        ) : admin ? (
          <>
            <User className="h-3.5 w-3.5 text-ink-2" />
            <span className="text-micro font-semibold text-ink">Pryva support team</span>
          </>
        ) : (
          <span className="text-micro font-semibold text-white/80">You</span>
        )}
        <span className={mine ? "text-micro text-white/60" : "text-micro text-ink-3"}>· {timeOf(message.createdAt)}</span>
        {message.pending ? <span className="text-micro text-white/60">· sending…</span> : null}
      </div>
      <div
        className={`mt-1.5 whitespace-pre-line text-[0.86rem] leading-relaxed ${
          mine ? "text-white/90" : "text-ink-2"
        }`}
      >
        {message.body}
      </div>
    </div>
  );
}

export function SupportChat({
  ticketId: initialTicketId = null,
  initialMessages = [],
  examples = [],
  closed = false,
  escalated: initiallyEscalated = false,
}: {
  ticketId?: string | null;
  initialMessages?: ChatMessage[];
  examples?: string[];
  closed?: boolean;
  escalated?: boolean;
}) {
  const router = useRouter();
  const [ticketId, setTicketId] = useState<string | null>(initialTicketId);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [presence, setPresence] = useState<PresenceState>("idle");
  const [status, setStatus] = useState<string | null>(null);
  const [escalated, setEscalated] = useState(initiallyEscalated);
  const [escalating, setEscalating] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const question = draftFromHash(window.location.hash);
    // Reading a browser-only value once after mount is what an effect is for;
    // reading it during render would make the server and client disagree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (question) setDraft((current) => current || question);
  }, []);

  useEffect(() => {
    // Scroll once the transcript grows, and only inside this card — never the page.
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages.length, sending]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (sending || text.length < 2) return;

    const optimistic = localMessage("customer", text);
    setMessages((current) => [...current, optimistic]);
    setDraft("");
    setError(null);
    setSending(true);
    setPresence("thinking");

    try {
      const response = await fetch(
        ticketId ? `/api/support/tickets/${ticketId}` : "/api/support/tickets",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        },
      );
      const data = (await response.json().catch(() => ({}))) as Reply;

      if (!response.ok || !data.ok) {
        throw new Error(data.error ?? "That did not send. Please try again.");
      }

      const createdId = typeof data.ticketId === "string" ? data.ticketId : null;
      if (createdId && !ticketId) {
        setTicketId(createdId);
        // The list of conversations is server-rendered; a new one belongs on it.
        router.refresh();
      }

      setMessages((current) => {
        const confirmed = current.map((message) =>
          message.id === optimistic.id ? { ...message, pending: false } : message,
        );
        const reply = typeof data.reply === "string" ? data.reply.trim() : "";
        return reply
          ? [...confirmed, localMessage("assistant", reply)]
          : [
              ...confirmed,
              localMessage(
                "system",
                data.status === "escalated"
                  ? "This is with a person now. They have everything the assistant checked."
                  : "Saved. A person will reply in this thread.",
              ),
            ];
      });

      if (typeof data.status === "string") setStatus(data.status);
      if (data.status === "escalated") setEscalated(true);
    } catch (failure) {
      // Nothing was recorded, so take the optimistic bubble back and put the text
      // where it was: losing a complaint to a network blip is worse than a retry.
      setMessages((current) => current.filter((message) => message.id !== optimistic.id));
      setDraft(text);
      setError(failure instanceof Error ? failure.message : "That did not send. Please try again.");
    } finally {
      setSending(false);
      setPresence("idle");
    }
  }, [draft, sending, ticketId, router]);

  const askForPerson = useCallback(async () => {
    if (!ticketId || escalating || escalated) return;
    setEscalating(true);
    setError(null);
    try {
      const response = await fetch(`/api/support/tickets/${ticketId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "escalate" }),
      });
      const data = (await response.json().catch(() => ({}))) as Reply;
      if (!response.ok || !data.ok) throw new Error(data.error ?? "That did not go through.");
      setEscalated(true);
      setStatus("escalated");
      setMessages((current) => [
        ...current,
        localMessage("system", "Passed to a person. Replies appear in this thread, and you will not be asked to explain it again."),
      ]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That did not go through.");
    } finally {
      setEscalating(false);
    }
  }, [ticketId, escalating, escalated]);

  const showGreeting = messages.length === 0 && !closed;

  return (
    <div className="grid gap-3">
      <AssistantPresence state={presence} />

      <section
        className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-4 sm:p-5"
        aria-label="Support conversation"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[0.95rem] font-semibold text-ink">
            {ticketId ? "Conversation" : "What is going wrong?"}
          </h2>
          {status ? <SupportStatusPill status={status} /> : null}
        </div>

        <div
          className="mt-3 grid max-h-[26rem] gap-2.5 overflow-y-auto pr-1"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
        >
          {showGreeting ? (
            <div className={`${BUBBLE_BASE} mr-auto rounded-bl-md border border-lav-200 bg-lav-50/60`}>
              <div className="flex items-center gap-1.5">
                <Sparkle className="h-3.5 w-3.5 text-lav-700" />
                <span className="text-micro font-semibold text-lav-800">Pryva assistant</span>
              </div>
              <p className="mt-1.5 text-[0.86rem] leading-relaxed text-ink-2">
                Describe it the way you would to a person. I read your account and can settle most problems
                without waiting — and when I cannot, I say so and a person takes over with the details already in
                hand.
              </p>
            </div>
          ) : null}

          {messages.map((message) => (
            <Bubble key={message.id} message={message} />
          ))}

          {sending ? (
            <div className="mr-auto flex items-center gap-2 rounded-2xl rounded-bl-md border border-lav-200 bg-lav-50/40 px-4 py-2.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-lav-700" />
              <span className="text-meta text-ink-2">Checking your account…</span>
            </div>
          ) : null}

          <div ref={endRef} />
        </div>

        {error ? (
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50/70 px-3 py-2 text-meta text-rose-800">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        ) : null}

        {closed ? (
          <p className="mt-3 rounded-xl border border-dashed border-line bg-cream/40 px-3 py-2 text-meta text-ink-3">
            This conversation is closed. Start a new one and it opens a fresh thread.
          </p>
        ) : (
          <form
            className="mt-3"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <label htmlFor="support-message" className="sr-only">
              Your message
            </label>
            <textarea
              id="support-message"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends; Shift+Enter is a new line. A chat that needs a mouse
                // is the same complaint as a chat that answers once.
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={3}
              maxLength={8000}
              placeholder={
                messages.length === 0
                  ? "e.g. I paid ₦5,000 an hour ago and my wallet is still empty."
                  : "Add anything that would help — a reference, what you expected, what happened next."
              }
              className="field w-full resize-y"
              disabled={sending}
            />

            {examples.length > 0 && messages.length === 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {examples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setDraft(example)}
                    className="rounded-full border border-line bg-white px-2.5 py-1 text-micro text-ink-2 hover:border-lav-300 hover:text-lav-800"
                  >
                    {example}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={sending || draft.trim().length < 2}
                className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2 text-[0.84rem] font-semibold text-white hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {messages.length === 0 ? "Ask the assistant" : "Send"}
              </button>

              {ticketId && !escalated ? (
                <button
                  type="button"
                  onClick={() => void askForPerson()}
                  disabled={escalating || sending}
                  className="rounded-xl border border-line px-3 py-2 text-[0.8rem] font-semibold text-ink-2 hover:border-lav-300 disabled:opacity-50"
                >
                  {escalating ? "Passing it on…" : "Ask for a person instead"}
                </button>
              ) : null}

              <span className="text-micro text-ink-3">Answers come from your own account records.</span>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}
