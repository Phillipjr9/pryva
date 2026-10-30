/**
 * The vocabulary of the support assistant.
 *
 * The assistant is two parts, kept apart on purpose:
 *
 *   * **the brain** (`knowledge.ts`) — what it knows about this business: the
 *     symptoms of each problem, the evidence that confirms one, what it can do
 *     about it, and what it must hand to a person;
 *   * **the engine** (`engine.ts`) — how it thinks: read the message, gather
 *     facts, score the explanations, decide whether it knows enough, act, then
 *     re-read the account to check the fix actually worked.
 *
 * Nothing here touches the database. The engine receives facts and a way to run
 * a remedy, which is what makes every decision in it testable with plain data.
 */

export const SUPPORT_STATUSES = [
  "open",
  "waiting_on_customer",
  "escalated",
  "resolved",
  "closed",
] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const SUPPORT_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

export const SUPPORT_CATEGORIES = [
  "payments",
  "orders",
  "wallet",
  "account",
  "scheduling",
  "gift-cards",
  "other",
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export function isSupportStatus(value: unknown): value is SupportStatus {
  return typeof value === "string" && (SUPPORT_STATUSES as readonly string[]).includes(value);
}

export function isSupportPriority(value: unknown): value is SupportPriority {
  return typeof value === "string" && (SUPPORT_PRIORITIES as readonly string[]).includes(value);
}

export function isSupportCategory(value: unknown): value is SupportCategory {
  return typeof value === "string" && (SUPPORT_CATEGORIES as readonly string[]).includes(value);
}

export const SUPPORT_STATUS_LABELS: Record<SupportStatus, string> = {
  open: "Open",
  waiting_on_customer: "Waiting on you",
  escalated: "With a person",
  resolved: "Resolved",
  closed: "Closed",
};

/* ------------------------------------------------------------------ facts -- */

export type LedgerEntry = {
  type: string;
  amount: number;
  balanceAfter: number;
  description: string;
  reference: string;
  createdAt: Date;
};

export type TopUpRecord = {
  reference: string;
  amount: number;
  status: string;
  createdAt: Date;
  paidAt: Date | null;
};

export type OrderRecord = {
  reference: string;
  service: string;
  productName: string;
  amount: number;
  status: string;
  createdAt: Date;
  refundedAt: Date | null;
};

export type ScheduleRecord = {
  id: string;
  service: string;
  productLabel: string;
  frequency: string;
  status: string;
  nextRunAt: Date;
};

export type GiftCardRecord = {
  code: string;
  amount: number;
  status: string;
  expiresAt: Date;
};

export type WithdrawalRecord = {
  amount: number;
  status: string;
  createdAt: Date;
};

/**
 * Everything the assistant is allowed to know about one customer.
 *
 * Deliberately narrow. There is no supplier, no wholesale cost, no other
 * customer and no credential in here — an assistant that cannot see a thing
 * cannot leak it, and the fact-building query is the place that guarantee lives.
 */
export type SupportFacts = {
  now: Date;
  account: {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    walletBalance: number;
    twoFactorEnabled: boolean;
    lockedUntil: Date | null;
    memberSince: Date;
  };
  ledger: LedgerEntry[];
  topUps: TopUpRecord[];
  orders: OrderRecord[];
  schedules: ScheduleRecord[];
  giftCards: GiftCardRecord[];
  withdrawals: WithdrawalRecord[];
  /** Whether payments can be checked at all in this environment. */
  paymentsReady: boolean;
};

/* ---------------------------------------------------------------- remedies -- */

export const REMEDY_IDS = ["resend_verification", "recheck_topup", "cancel_schedule"] as const;
export type RemedyId = (typeof REMEDY_IDS)[number];

/**
 * What a remedy would act on. Narrow types rather than an id string: a remedy
 * that takes "some reference" could be pointed at another customer's deposit by
 * a mistake, and this shape makes that hard to express.
 */
export type RemedyTarget =
  | { kind: "verification_email"; email: string }
  | { kind: "topup"; reference: string; amount: number }
  | { kind: "schedule"; id: string; label: string };

export type RemedyPlan =
  | { ok: true; remedy: RemedyId; target: RemedyTarget; label: string }
  | { ok: false; reason: string };

export type ActionOutcome = {
  remedy: RemedyId;
  label: string;
  status: "succeeded" | "failed" | "skipped";
  note: string;
};

/* --------------------------------------------------------------- thinking -- */

export type EvidenceSignal = {
  /** 0 = irrelevant, 1 = this is certainly the problem. */
  weight: number;
  /** Why the fact counted. Written for the operator reading the trace. */
  note: string;
};

export type AnswerContext = {
  facts: SupportFacts;
  /** The remedy that ran for this message, if one did. */
  action?: ActionOutcome;
  /** What the customer actually wrote, for playbooks that answer a specific question. */
  message: string;
};

export type Playbook = {
  id: string;
  title: string;
  category: SupportCategory;
  /** Used when a person takes over, and to order the queue. */
  priority: SupportPriority;
  /**
   * How much the wording of the message counts against the state of the
   * account. A question about how something works is settled by the wording; a
   * claim that money is missing is not.
   */
  mixing: { intent: number; evidence: number };
  intents: Array<{ label: string; pattern: RegExp; weight: number }>;
  /** Read the account and report what bears on this. Empty when nothing does. */
  corroborate: (facts: SupportFacts, message: string) => EvidenceSignal[];
  /** The reply when the assistant is confident, written from real data only. */
  answer: (ctx: AnswerContext) => string;
  /** One question that would settle it when the assistant is not confident. */
  ask: string;
  /**
   * One detail the answer needs even when the assistant *is* confident — which
   * of three scheduled orders, which order, which card. Returning a question
   * stops the engine before it acts on a guess. */
  clarify?: (facts: SupportFacts, message: string) => string | null;
  /** What it can actually do, if anything. */
  remedy?: (facts: SupportFacts, message: string) => RemedyPlan;
  /** Check, after acting, that the fix is really in place. */
  verify?: (after: SupportFacts, target: RemedyTarget) => { ok: boolean; note: string };
  /**
   * A reason this must go to a person even when the assistant understood it.
   * Returning null means "no reason to escalate".
   */
  needsHuman?: (ctx: AnswerContext) => string | null;
};

/* ------------------------------------------------------------------ engine -- */

export type TraceStepKind = "read" | "gather" | "think" | "decide" | "act" | "verify" | "conclude";

export type TraceStep = {
  kind: TraceStepKind;
  title: string;
  detail: string;
};

/** How sure the assistant has to be before it does each kind of thing. */
export const CONFIDENCE = {
  /** Answer on its own, and run the remedy if there is one. */
  act: 0.72,
  /** Ask one question rather than guess. */
  ask: 0.4,
  /** Two explanations this close together are not worth guessing between. */
  tie: 0.06,
} as const;

export type EngineOutcome = "fixed" | "answered" | "awaiting_customer" | "escalated";

export type EngineResult = {
  playbookId: string;
  confidence: number;
  outcome: EngineOutcome;
  /** What the customer is told. */
  reply: string;
  /** Who the ticket now sits with. */
  status: SupportStatus;
  priority: SupportPriority;
  category: SupportCategory;
  actions: ActionOutcome[];
  trace: TraceStep[];
};

export type EngineDeps = {
  /** Run one remedy. The engine never performs a side effect itself. */
  runRemedy: (remedy: RemedyId, target: RemedyTarget) => Promise<ActionOutcome>;
  /** Re-read the account after an action, so the reply can be checked. */
  reload: () => Promise<SupportFacts>;
};
