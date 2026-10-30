import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/auth";
import { SupportStatusPill } from "@/components/support/SupportStatusPill";
import { getThread, getTicket } from "@/lib/support-tickets";
import { ArrowLeft, Sparkle, User } from "@/components/icons";

import { AdminTicketControls } from "./AdminTicketControls";

export const dynamic = "force-dynamic";

type TraceStep = { kind: string; title: string; detail: string };
type TraceRecord = {
  playbook?: string;
  confidence?: number;
  outcome?: string;
  actions?: Array<{ remedy: string; status: string; note: string }>;
  steps?: TraceStep[];
};

function parseTrace(raw: string | null): TraceRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as TraceRecord;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    // A trace that cannot be parsed is still evidence that one was written; say
    // so rather than pretending the assistant never explained itself.
    return null;
  }
}

/**
 * One ticket, for the operator.
 *
 * The point of this page is the `<details>` block under every assistant reply.
 * An escalated ticket opened cold is twenty minutes of reading; opened with the
 * evidence it used, the options it rejected and the reason it stopped, it is a
 * decision. Nothing here is hidden from the person taking over.
 */
export default async function AdminSupportTicketPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin("/admin/support");
  const { id } = await params;

  const ticket = await getTicket(id);
  if (!ticket) notFound();

  const messages = await getThread(ticket.id);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <Link href="/admin/support" className="inline-flex items-center gap-1.5 text-meta text-ink-3 hover:text-lav-700">
        <ArrowLeft className="h-3.5 w-3.5" /> Support queue
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <h1 className="min-w-0 text-[1.4rem] font-semibold text-ink">{ticket.subject}</h1>
        <SupportStatusPill status={ticket.status} />
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-micro font-semibold text-slate-700">
          {ticket.priority}
        </span>
      </div>
      <p className="mt-1 text-meta text-ink-3">
        {ticket.category} · opened{" "}
        {new Date(ticket.createdAt).toLocaleString("en-NG", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
        {ticket.handledBy ? ` · handled by ${ticket.handledBy}` : ""}
        {ticket.assistantConfidence !== null ? ` · assistant ${ticket.assistantConfidence}% confident` : ""}
      </p>

      <div className="mt-4 grid gap-2.5">
        {messages.map((message) => {
          const trace = message.authorRole === "assistant" ? parseTrace(message.trace) : null;
          return (
            <div
              key={message.id}
              className={
                message.authorRole === "customer"
                  ? "rounded-2xl border border-line bg-white px-4 py-3"
                  : message.authorRole === "assistant"
                    ? "rounded-2xl border border-lav-200 bg-lav-50/50 px-4 py-3"
                    : "rounded-2xl border border-line bg-[#fffdfa] px-4 py-3"
              }
            >
              <div className="flex flex-wrap items-center gap-1.5">
                {message.authorRole === "assistant" ? (
                  <>
                    <Sparkle className="h-3.5 w-3.5 text-lav-700" />
                    <span className="text-micro font-semibold text-lav-800">Pryva assistant</span>
                  </>
                ) : message.authorRole === "admin" ? (
                  <>
                    <User className="h-3.5 w-3.5 text-ink-2" />
                    <span className="text-micro font-semibold text-ink">Support team</span>
                  </>
                ) : (
                  <span className="text-micro font-semibold text-ink-2">Customer</span>
                )}
                <span className="text-micro text-ink-3">
                  {new Date(message.createdAt).toLocaleString("en-NG", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>

              <div className="mt-1.5 whitespace-pre-line text-[0.86rem] leading-relaxed text-ink-2">{message.body}</div>

              {message.authorRole === "assistant" ? (
                <details className="mt-2.5 rounded-xl border border-lav-200 bg-white/70 px-3 py-2">
                  <summary className="cursor-pointer text-micro font-semibold text-lav-800">
                    How it decided this
                    {trace?.confidence !== undefined ? ` · ${trace.confidence}% · ${trace.playbook ?? "unknown"}` : ""}
                  </summary>
                  {trace ? (
                    <div className="mt-2 grid gap-2">
                      {(trace.steps ?? []).map((step, index) => (
                        <div key={`${step.kind}-${index}`}>
                          <p className="text-micro font-semibold uppercase tracking-wide text-ink-3">
                            {step.kind} · {step.title}
                          </p>
                          <p className="whitespace-pre-line text-meta leading-relaxed text-ink-2">{step.detail}</p>
                        </div>
                      ))}
                      {trace.actions && trace.actions.length > 0 ? (
                        <div>
                          <p className="text-micro font-semibold uppercase tracking-wide text-ink-3">Actions</p>
                          {trace.actions.map((action, index) => (
                            <p key={`${action.remedy}-${index}`} className="text-meta text-ink-2">
                              {action.remedy} — {action.status}: {action.note}
                            </p>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-2 text-meta text-ink-3">No readable trace was stored for this reply.</p>
                  )}
                </details>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="mt-4">
        <AdminTicketControls ticketId={ticket.id} status={ticket.status} priority={ticket.priority} />
      </div>
    </div>
  );
}
