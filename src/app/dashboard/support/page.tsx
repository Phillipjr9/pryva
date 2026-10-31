import type { Metadata } from "next";
import Link from "next/link";
import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { contactMessages } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { SupportChat } from "@/components/support/SupportChat";
import { SupportStatusPill } from "@/components/support/SupportStatusPill";
import { listTicketsForUser } from "@/lib/support-tickets";
import { ArrowRight, CheckCircle, Clock, MessageCircle, Refresh, Sparkle } from "@/components/icons";

export const metadata: Metadata = { title: "Support" };
export const dynamic = "force-dynamic";

const EXAMPLES = [
  "I paid but my wallet wasn't credited",
  "My order hasn't arrived",
  "Stop my scheduled order",
  "I never got the verification email",
];

/**
 * Support, as a conversation.
 *
 * It used to be a contact form and a list of what you had already sent — one-way,
 * with "response times may vary" where an answer should be. Now the first reply
 * comes from the assistant, in the same request, after it has read the account.
 * Most problems are answered or actually fixed before a person sees the ticket;
 * the ones that are not arrive with the diagnosis attached.
 *
 * What it can do is listed below the box rather than hidden in it. A support
 * feature that oversells itself ("24/7 instant answers to everything") gets
 * trusted once and never again.
 */
export default async function SupportPage() {
  const user = await requireUser("/dashboard/support");

  const [tickets, messages] = await Promise.all([
    listTicketsForUser(user.id, 10),
    db
      .select()
      .from(contactMessages)
      .where(eq(contactMessages.userId, user.id))
      .orderBy(desc(contactMessages.createdAt))
      .limit(3),
  ]);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <div>
        <h1 className="text-[1.5rem] font-medium tracking-tight text-ink sm:text-[1.7rem]">Support</h1>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          Describe the problem and the assistant will check your account straight away — it can fix most things
          without waiting for anyone. Anything it cannot, a person picks up with the details already in hand.
        </p>
      </div>

      <SupportChat examples={EXAMPLES} />

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-start">
        <div className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-[1rem] font-semibold">Your conversations</h2>
            <MessageCircle className="h-4 w-4 text-lav-600" />
          </div>

          {tickets.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-line bg-cream/50 px-4 py-6 text-center text-[0.8rem] text-ink-3">
              Nothing yet. When you ask something, the conversation is kept here so you never have to explain it
              twice.
            </p>
          ) : (
            <div className="mt-3 grid gap-2.5">
              {tickets.map((ticket) => (
                <Link
                  key={ticket.id}
                  href={`/dashboard/support/${ticket.id}`}
                  className="group block rounded-xl border border-line bg-white p-3.5 hover:border-lav-300"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 truncate text-meta font-semibold text-ink">{ticket.subject}</p>
                    <SupportStatusPill status={ticket.status} />
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 text-micro text-ink-3">
                    <Clock className="h-3 w-3" />
                    {new Date(ticket.lastActivityAt).toLocaleString("en-NG", {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    <span className="text-ink-3 group-hover:text-lav-700">· open</span>
                  </p>
                </Link>
              ))}
            </div>
          )}

          {messages.length > 0 ? (
            <div className="mt-5 border-t border-line pt-4">
              <h3 className="text-[0.86rem] font-semibold text-ink">Contact-form messages</h3>
              <p className="mt-0.5 text-micro text-ink-3">
                Sent before this page became a conversation. They are in the support inbox; reply here instead and
                the assistant can work on the actual account.
              </p>
              <div className="mt-2 grid gap-1.5">
                {messages.map((message) => (
                  <div key={message.id} className="rounded-lg bg-cream/50 px-3 py-2">
                    <p className="text-micro font-semibold text-ink-2">{message.topic}</p>
                    <p className="line-clamp-2 text-micro text-ink-3">{message.message}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid gap-4">
          <div className="rounded-[1.5rem] border border-lav-200 bg-gradient-to-br from-lav-50 to-white p-5">
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-white text-lav-700">
                <Sparkle className="h-4 w-4" />
              </span>
              <p className="text-[0.88rem] font-semibold text-ink">What the assistant can do on its own</p>
            </div>
            <ul className="mt-3 grid gap-2 text-meta text-ink-2">
              {[
                { icon: Refresh, text: "Re-check a deposit with Paystack and credit it if the money really arrived" },
                { icon: CheckCircle, text: "Send a fresh email-verification link" },
                { icon: CheckCircle, text: "Stop a scheduled order before it takes anything again" },
                { icon: MessageCircle, text: "Explain what happened to an order, refund, gift card or withdrawal, from your own records" },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.text} className="flex gap-2">
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lav-600" />
                    <span>{item.text}</span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 rounded-lg bg-white/80 px-3 py-2 text-micro leading-relaxed text-ink-3">
              It cannot move money out, approve a withdrawal, switch off two-factor or refund an order. Those stay
              with a person — and it says so instead of promising otherwise.
            </p>
          </div>

          <div className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
            <p className="text-[0.85rem] font-semibold text-ink">Might answer it faster</p>
            <div className="mt-2.5 grid gap-1.5 text-meta">
              <Link href="/faq" className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-ink-2 hover:text-lav-700">
                Read the FAQ <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <Link href="/dashboard/orders" className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-ink-2 hover:text-lav-700">
                Find an order code <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <Link href="/refund-policy" className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-ink-2 hover:text-lav-700">
                Refund policy <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <Link href="/contact" className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-ink-2 hover:text-lav-700">
                General enquiry <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
