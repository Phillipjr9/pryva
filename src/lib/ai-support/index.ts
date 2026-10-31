import { logger } from "@/lib/logger";
import { addAssistantMessage } from "@/lib/support-tickets";

import { loadSupportFacts, runSupportRemedy } from "./actions";
import { runSupportEngine } from "./engine";
import { polishSupportReply } from "./model";
import type { ActionOutcome, EngineResult, RemedyTarget, SupportFacts } from "./types";

export { loadSupportFacts, runSupportRemedy } from "./actions";
export { runSupportEngine, scoreAll, scorePlaybook, normaliseMessage } from "./engine";
export { supportModelConfigured } from "./model";
export * from "./types";

/**
 * Answer one message on a ticket.
 *
 * This is the only entry point the rest of the app uses. It gathers the account's
 * facts, thinks, acts if it can, and then writes two things: the reply the
 * customer sees, and the reasoning trail only an operator sees. A ticket that is
 * handed over therefore arrives with its diagnosis attached instead of starting
 * the conversation again.
 */
export async function respondToTicket(input: {
  ticketId: string;
  userId: string;
  userEmail: string;
  userName: string;
  message: string;
}): Promise<EngineResult> {
  const facts = await loadSupportFacts(input.userId);

  const result = await runSupportEngine({
    message: input.message,
    facts,
    deps: {
      runRemedy: (remedy, target: RemedyTarget) =>
        runSupportRemedy({
          userId: input.userId,
          userEmail: input.userEmail,
          userName: input.userName,
          remedy,
          target,
          facts,
        }),
      reload: (): Promise<SupportFacts> => loadSupportFacts(input.userId),
    },
  });

  // The model, if the owner has switched it on, may only re-word a decision that
  // has already been made. A null answer means "keep the draft".
  const polished = result.outcome === "escalated" ? null : await polishSupportReply(result.reply);
  const body = polished ?? result.reply;

  await addAssistantMessage({
    ticketId: input.ticketId,
    body,
    trace: JSON.stringify(traceRecord(result), null, 2),
    status: result.status,
    priority: result.priority,
    category: result.category,
    confidence: result.confidence,
    escalated: result.outcome === "escalated",
    resolved: result.outcome === "fixed" || result.outcome === "answered",
  });

  logger.info("Support assistant handled a ticket message", {
    ticketId: input.ticketId,
    playbook: result.playbookId,
    outcome: result.outcome,
    confidence: Math.round(result.confidence * 100),
    actions: result.actions.map((action) => `${action.remedy}:${action.status}`),
    polished: Boolean(polished),
  });

  return result;
}

/**
 * The durable part of the reasoning: what was considered, what was done, and
 * what the account looked like afterwards.
 *
 * Shaped for a person reading it in a hurry — the admin thread renders this
 * verbatim — and never shown to the customer.
 */
export function traceRecord(result: EngineResult): Record<string, unknown> {
  return {
    playbook: result.playbookId,
    confidence: Math.round(result.confidence * 100),
    outcome: result.outcome,
    actions: result.actions.map((action: ActionOutcome) => ({
      remedy: action.remedy,
      status: action.status,
      note: action.note,
    })),
    steps: result.trace.map((step) => ({ kind: step.kind, title: step.title, detail: step.detail })),
  };
}
