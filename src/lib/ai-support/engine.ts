import { formatCurrency } from "@/lib/format";

import { PLAYBOOKS, FALLBACK_PLAYBOOK } from "./knowledge";
import {
  CONFIDENCE,
  type ActionOutcome,
  type AnswerContext,
  type EngineDeps,
  type EngineResult,
  type Playbook,
  type SupportFacts,
  type SupportStatus,
  type TraceStep,
} from "./types";

/**
 * The engine: how the support assistant thinks.
 *
 * It is a small, deterministic loop, and that is the point. Every decision is
 * made from facts read out of this database and from the message in front of it,
 * so the same ticket gets the same answer twice, the answer can be explained to
 * an operator line by line, and nothing it says can be an invention. When it does
 * not know, it says so and hands over rather than producing something plausible.
 *
 *   1. **read**     what is this about? which explanations does the wording fit?
 *   2. **gather**   what does this account actually look like right now?
 *   3. **think**    score every explanation the brain knows, with reasons.
 *   4. **decide**   act, ask one question, or hand to a person.
 *   5. **act**      run the remedy, if the explanation calls for one.
 *   6. **verify**   re-read the account and check the fix landed.
 *   7. **conclude** write the reply and the ticket's next state.
 *
 * Steps 1-4 are cheap and pure; the side effects are injected through
 * `EngineDeps`, which is why the whole thing is testable with plain objects.
 */

export type ScoredPlaybook = {
  playbook: Playbook;
  /** How well the wording of the message fits, 0-1. */
  intent: number;
  /** How well the account's state fits, 0-1. */
  evidence: number;
  /** `mixing`-weighted combination, 0-1. */
  score: number;
  matched: string[];
  signals: Array<{ weight: number; note: string }>;
};

/** Lowercase, collapse whitespace, keep punctuation that carries meaning. */
export function normaliseMessage(message: string): string {
  return message.replace(/\s+/g, " ").trim().toLowerCase();
}

export function scorePlaybook(playbook: Playbook, facts: SupportFacts, message: string): ScoredPlaybook {
  const text = normaliseMessage(message);
  const matched: string[] = [];
  let intent = 0;

  for (const intentDef of playbook.intents) {
    if (!intentDef.pattern.test(text)) continue;
    matched.push(intentDef.label);
    intent += intentDef.weight;
  }
  intent = Math.min(1, Math.round(intent * 100) / 100);

  const signals = playbook.corroborate(facts, text);
  // The strongest signal decides, and each further corroborating fact adds a
  // little. Averaging them was wrong for the obvious case: one decisive fact
  // (an unsettled deposit) must not be diluted by a weak supporting one (the
  // wallet being empty), or the assistant would ask a question it could answer.
  const evidence = signals.length === 0
    ? 0
    : Math.round(Math.min(1, Math.max(...signals.map((signal) => signal.weight)) + 0.05 * (signals.length - 1)) * 100) / 100;

  const { intent: intentWeight, evidence: evidenceWeight } = playbook.mixing;
  const total = intentWeight + evidenceWeight || 1;
  const score = Math.round(((intent * intentWeight + evidence * evidenceWeight) / total) * 100) / 100;

  return { playbook, intent, evidence, score, matched, signals };
}

/** Every playbook, best first. Ties keep the order the brain declares. */
export function scoreAll(facts: SupportFacts, message: string): ScoredPlaybook[] {
  return PLAYBOOKS
    .map((playbook) => scorePlaybook(playbook, facts, message))
    .sort((a, b) => b.score - a.score);
}

function describeFacts(facts: SupportFacts): string {
  const pendingTopUps = facts.topUps.filter((topUp) => topUp.status === "pending").length;
  const openOrders = facts.orders.filter((order) => order.status === "active" || order.status === "processing").length;
  const activeSchedules = facts.schedules.filter((schedule) => schedule.status === "active").length;
  return [
    `balance ${formatCurrency(facts.account.walletBalance)}`,
    `${facts.ledger.length} recent ledger ${facts.ledger.length === 1 ? "entry" : "entries"}`,
    `${facts.topUps.length} recent ${facts.topUps.length === 1 ? "top-up" : "top-ups"}${pendingTopUps ? ` (${pendingTopUps} pending)` : ""}`,
    `${facts.orders.length} recent ${facts.orders.length === 1 ? "order" : "orders"}${openOrders ? ` (${openOrders} open)` : ""}`,
    `${activeSchedules} active ${activeSchedules === 1 ? "schedule" : "schedules"}`,
    `${facts.giftCards.length} ${facts.giftCards.length === 1 ? "gift card" : "gift cards"}`,
    `email ${facts.account.emailVerified ? "verified" : "not verified"}`,
    facts.paymentsReady ? "payment provider reachable" : "payment provider not configured here",
  ].join(" · ");
}

function moneyPriority(category: Playbook["category"], fallback: Playbook["priority"]): Playbook["priority"] {
  if (fallback === "urgent") return "urgent";
  // Money that did not arrive, or went somewhere it should not have, outranks a
  // question about how something works.
  if (category === "payments" || category === "wallet") return fallback === "low" ? "normal" : "high";
  return fallback;
}

export async function runSupportEngine(input: {
  message: string;
  facts: SupportFacts;
  deps: EngineDeps;
}): Promise<EngineResult> {
  const { message, facts, deps } = input;
  const trace: TraceStep[] = [];
  const actions: ActionOutcome[] = [];

  // 1. read ------------------------------------------------------------------
  const scored = scoreAll(facts, message);
  const best = scored[0];
  const runnerUp = scored[1];

  trace.push({
    kind: "read",
    title: "Read the message",
    detail: `${message.trim().split(/\s+/).length} words. ${
      best && best.matched.length > 0
        ? `It reads like "${best.playbook.title}" (matched ${best.matched.map((label) => `"${label}"`).join(", ")}).`
        : "No known problem wording matched."
    }`,
  });

  // 2. gather ----------------------------------------------------------------
  trace.push({ kind: "gather", title: "Looked at the account", detail: describeFacts(facts) });

  // 3. think -----------------------------------------------------------------
  const thought = scored
    .slice(0, 3)
    .filter((candidate) => candidate.score > 0)
    .map((candidate) => {
      const reasons = candidate.signals.map((signal) => signal.note).slice(0, 3);
      return `• ${candidate.playbook.title} — ${Math.round(candidate.score * 100)}% (wording ${Math.round(candidate.intent * 100)}%, account ${Math.round(candidate.evidence * 100)}%)${reasons.length ? `: ${reasons.join("; ")}` : ""}`;
    });
  trace.push({
    kind: "think",
    title: "Weighed the explanations",
    detail: thought.length > 0 ? thought.join("\n") : "Nothing in the message or the account pointed anywhere in particular.",
  });

  const confidence = best?.score ?? 0;
  const ambiguous = Boolean(
    best && runnerUp && best.score >= CONFIDENCE.ask && best.score < CONFIDENCE.act
      && Math.abs(best.score - runnerUp.score) < CONFIDENCE.tie,
  );

  // 4. decide ----------------------------------------------------------------
  if (!best || best.score < CONFIDENCE.ask) {
    trace.push({
      kind: "decide",
      title: "Not enough to act on",
      detail: `Best explanation scored ${Math.round(confidence * 100)}%, below the ${Math.round(CONFIDENCE.ask * 100)}% needed to answer. Handing over instead of guessing.`,
    });
    const fallback = FALLBACK_PLAYBOOK.answer({ facts, message });
    trace.push({ kind: "conclude", title: "Escalated", detail: "No known cause; a person takes it from here with the account summary above." });
    return {
      playbookId: FALLBACK_PLAYBOOK.id,
      confidence,
      outcome: "escalated",
      reply: fallback,
      status: "escalated",
      priority: moneyPriority("other", "normal"),
      category: "other",
      actions,
      trace,
    };
  }

  const playbook = best.playbook;

  if (ambiguous) {
    trace.push({
      kind: "decide",
      title: "Too close to call",
      detail: `"${playbook.title}" (${Math.round(best.score * 100)}%) and "${runnerUp.playbook.title}" (${Math.round(runnerUp.score * 100)}%) are within ${Math.round(CONFIDENCE.tie * 100)} points. Asking one question is cheaper than fixing the wrong thing.`,
    });
    trace.push({ kind: "conclude", title: "Question asked", detail: "Waiting on the customer's answer; the ticket stays with them." });
    return {
      playbookId: playbook.id,
      confidence,
      outcome: "awaiting_customer",
      reply: `${playbook.ask}\n\n(If it is the other thing — ${runnerUp.playbook.title.toLowerCase()} — say so and I will look at that instead.)`,
      status: "waiting_on_customer",
      priority: moneyPriority(playbook.category, playbook.priority),
      category: playbook.category,
      actions,
      trace,
    };
  }

  if (best.score < CONFIDENCE.act) {
    trace.push({
      kind: "decide",
      title: "Partly matched",
      detail: `"${playbook.title}" scored ${Math.round(best.score * 100)}% — enough to know the area, not enough to act. Asking one question.`,
    });
    trace.push({ kind: "conclude", title: "Question asked", detail: "Waiting on the customer's answer." });
    return {
      playbookId: playbook.id,
      confidence,
      outcome: "awaiting_customer",
      reply: playbook.ask,
      status: "waiting_on_customer",
      priority: moneyPriority(playbook.category, playbook.priority),
      category: playbook.category,
      actions,
      trace,
    };
  }

  trace.push({
    kind: "decide",
    title: `Going with "${playbook.title}"`,
    detail: `${Math.round(best.score * 100)}% — above the ${Math.round(CONFIDENCE.act * 100)}% needed to act.${
      runnerUp && runnerUp.score > 0.2 ? ` Next best was "${runnerUp.playbook.title}" at ${Math.round(runnerUp.score * 100)}%.` : ""
    }`,
  });

  // One detail the answer needs before anything is changed. Asking beats
  // acting on the wrong order, the wrong card or the wrong schedule.
  const clarification = playbook.clarify?.(facts, message);
  if (clarification) {
    trace.push({
      kind: "decide",
      title: "Needs one detail",
      detail: "The explanation fits, but more than one thing on the account could be the subject. Asking rather than picking.",
    });
    trace.push({ kind: "conclude", title: "Question asked", detail: "Waiting on the customer's answer." });
    return {
      playbookId: playbook.id,
      confidence,
      outcome: "awaiting_customer",
      reply: clarification,
      status: "waiting_on_customer",
      priority: moneyPriority(playbook.category, playbook.priority),
      category: playbook.category,
      actions,
      trace,
    };
  }

  // 5. act -------------------------------------------------------------------
  let action: ActionOutcome | undefined;
  let escalatedBecause: string | null = null;

  const plan = playbook.remedy?.(facts, message);
  if (plan && !plan.ok) {
    trace.push({ kind: "act", title: "Could not fix it here", detail: plan.reason });
    escalatedBecause = plan.reason;
  } else if (plan && plan.ok) {
    try {
      action = await deps.runRemedy(plan.remedy, plan.target);
    } catch {
      // A remedy that throws is a failed remedy, not a crashed conversation.
      action = { remedy: plan.remedy, label: plan.label, status: "failed", note: "The fix could not be completed." };
    }
    actions.push(action);
    trace.push({
      kind: "act",
      title: `Ran: ${action.label}`,
      detail: `${action.status === "succeeded" ? "Succeeded" : action.status === "skipped" ? "Skipped" : "Failed"} — ${action.note}`,
    });
  } else {
    trace.push({ kind: "act", title: "Nothing to run", detail: "This one is answered rather than fixed; no action changes anything." });
  }

  // 6. verify ----------------------------------------------------------------
  let after = facts;
  if (action && action.status === "succeeded") {
    try {
      after = await deps.reload();
    } catch {
      after = facts;
    }
    const verdict = plan && plan.ok && playbook.verify
      ? playbook.verify(after, plan.target)
      : { ok: true, note: "Checked the action's own result; this one has nothing further to read back." };
    trace.push({ kind: "verify", title: "Checked it actually worked", detail: `${verdict.ok ? "Confirmed" : "Not confirmed"} — ${verdict.note}` });
    if (!verdict.ok) {
      escalatedBecause = "The fix did not take effect.";
    }
  } else if (action && action.status === "failed") {
    trace.push({ kind: "verify", title: "Nothing to check", detail: "The action did not complete, so there is no result to read back." });
    escalatedBecause = "The automatic fix failed.";
  }

  // 7. conclude --------------------------------------------------------------
  const context: AnswerContext = { facts: after, action, message };
  const humanReason = escalatedBecause ?? playbook.needsHuman?.(context) ?? null;
  const reply = playbook.answer(context);
  const status: SupportStatus = humanReason ? "escalated" : action?.status === "succeeded" ? "resolved" : "resolved";

  trace.push({
    kind: "conclude",
    title: humanReason ? "Handing to a person" : action?.status === "succeeded" ? "Fixed" : "Answered",
    detail: humanReason
      ? `${humanReason} The thread, this trail and the account summary go with it.`
      : action?.status === "succeeded"
        ? "The customer is told what changed, in plain words."
        : "Answered from the account's own records; nothing was changed.",
  });

  return {
    playbookId: playbook.id,
    confidence,
    outcome: humanReason ? "escalated" : action?.status === "succeeded" ? "fixed" : "answered",
    reply: humanReason ? `${reply}\n\n${humanLine(humanReason)}` : reply,
    status,
    priority: humanReason
      ? moneyPriority(playbook.category, playbook.priority === "low" ? "normal" : playbook.priority)
      : playbook.priority,
    category: playbook.category,
    actions,
    trace,
  };
}

/**
 * The sentence a customer reads when a person is taking over.
 *
 * It says what happens next and gives the ticket number nowhere else to go —
 * no promise of a time we cannot keep, and no pretending the assistant is
 * still working on it.
 */
function humanLine(reason: string): string {
  return `I'm passing this to a person rather than guess: ${reason.toLowerCase()} Your ticket stays open and the reply will appear in this thread.`;
}
