import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { SupportStatusPill } from "@/components/support/SupportStatusPill";
import { TicketReplyForm } from "@/components/support/TicketReplyForm";
import { getThread, getTicketForUser } from "@/lib/support-tickets";
import { AlertCircle, ArrowLeft, Sparkle, User } from "@/components/icons";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Support conversation" };

/**
 * One conversation.
 *
 * Three voices appear here and they are labelled: the customer, the assistant,
 * and — when it has been handed over — a person on the team. The assistant's
 * reasoning is *not* shown: it is the operator's copy, and a customer reading
 * "confidence 91%" learns nothing useful about their deposit.
 */
export default async function SupportThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("/dashboard/support");
  const { id } = await params;

  const ticket = await getTicketForUser(user.id, id);
  if (!ticket) notFound();

  const messages = await getThread(ticket.id);
  const escalated = ticket.status === "escalated";

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <div>
        <Link
          href="/dashboard/support"
          className="inline-flex items-center gap-1.5 text-meta text-ink-3 hover:text-lav-700"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All conversations
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 text-[1.35rem] font-medium tracking-tight text-ink sm:text-[1.5rem]">
            {ticket.subject}
          </h1>
          <SupportStatusPill status={ticket.status} />
        </div>
      </div>

      {escalated ? (
        <div className="flex items-start gap-2.5 rounded-2xl border border-rose-200 bg-rose-50/60 p-4">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <p className="text-meta leading-relaxed text-rose-900">
            This is with a person now. Everything the assistant already checked is attached to the thread, so you
            will not be asked to explain it again. Replies appear here.
          </p>
        </div>
      ) : null}

      <div className="grid gap-2.5">
        {messages.map((message) => {
          const mine = message.authorRole === "customer";
          const assistant = message.authorRole === "assistant";
          const admin = message.authorRole === "admin";
          return (
            <div
              key={message.id}
              className={
                mine
                  ? "ml-auto w-full max-w-[46rem] rounded-2xl rounded-br-md border border-line bg-ink px-4 py-3 text-white"
                  : assistant
                    ? "mr-auto w-full max-w-[46rem] rounded-2xl rounded-bl-md border border-lav-200 bg-lav-50/60 px-4 py-3"
                    : "mr-auto w-full max-w-[46rem] rounded-2xl rounded-bl-md border border-line bg-[#fffdfa] px-4 py-3"
              }
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
                <span className={mine ? "text-micro text-white/60" : "text-micro text-ink-3"}>
                  ·{" "}
                  {new Date(message.createdAt).toLocaleString("en-NG", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <div
                className={
                  mine
                    ? "mt-1.5 whitespace-pre-line text-[0.86rem] leading-relaxed text-white/90"
                    : "mt-1.5 whitespace-pre-line text-[0.86rem] leading-relaxed text-ink-2"
                }
              >
                {message.body}
              </div>
            </div>
          );
        })}
      </div>

      <TicketReplyForm ticketId={ticket.id} closed={ticket.status === "closed"} />
    </div>
  );
}
