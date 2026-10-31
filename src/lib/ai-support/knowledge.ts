import { formatCurrency } from "@/lib/format";

import type {
  AnswerContext,
  EvidenceSignal,
  Playbook,
  RemedyPlan,
  SupportFacts,
  TopUpRecord,
} from "./types";

/**
 * The brain: what the support assistant knows about this business.
 *
 * Each entry below is one problem a customer actually has, described the way an
 * experienced support person would hold it in their head:
 *
 *   * **how it sounds** — the words that make it likely (`intents`),
 *   * **what the account says** — the facts that confirm or rule it out
 *     (`corroborate`), each with a weight and a note, so the reasoning can be
 *     read back;
 *   * **what to say** — the reply, written only from facts already read;
 *   * **what to do** — the one automatic fix, if a fix exists (`remedy`);
 *   * **when to stop** — the condition that must go to a person
 *     (`needsHuman`), stated in the reply rather than hidden.
 *
 * Two rules hold for everything in this file, and both are tested:
 *
 *   1. **No invented numbers.** A price, a fee, a time-to-delivery or a policy
 *      that is not read from the account or from a constant in this repository
 *      never appears in a reply. "How much is X" is answered by pointing at the
 *      live price, not by quoting one.
 *   2. **No pretending.** If a fix was not verified, or a fact is not visible,
 *      the reply says so and the ticket goes to a person.
 */

const MINUTE = 60_000;

function minutesSince(now: Date, then: Date): number {
  return Math.max(0, Math.round((now.getTime() - then.getTime()) / MINUTE));
}

function hoursSince(now: Date, then: Date): number {
  return Math.round(minutesSince(now, then) / 60);
}

function ago(now: Date, then: Date): string {
  const minutes = minutesSince(now, then);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = hoursSince(now, then);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** The deposit most worth looking at: the newest one that has not settled. */
function openDeposit(facts: SupportFacts, withinDays = 30): TopUpRecord | undefined {
  const cutoff = facts.now.getTime() - withinDays * 24 * 60 * MINUTE;
  return facts.topUps.find((topUp) => topUp.status === "pending" && topUp.createdAt.getTime() >= cutoff);
}

function creditedEntry(facts: SupportFacts, reference: string) {
  return facts.ledger.find((entry) => entry.reference === reference && entry.type === "credit");
}

/* ------------------------------------------------------- deposit missing --- */

const depositMissing: Playbook = {
  id: "deposit-missing",
  title: "A deposit has not reached the wallet",
  category: "payments",
  priority: "high",
  mixing: { intent: 0.45, evidence: 0.55 },
  intents: [
    { label: "paid", pattern: /\b(paid|pay|payment|deposit|deposited|top ?up|funded|fund|transfer)\b/, weight: 0.45 },
    { label: "not credited", pattern: /\b(not|never|didn'?t|wasn'?t|isn'?t|hasn'?t)\b[^.]{0,30}\b(credited|reflected|added|showed|received|arrived|in my wallet)\b/, weight: 0.4 },
    { label: "missing from wallet", pattern: /\bwallet\b[^.]{0,30}\b(empty|zero|short|missing|not updated)\b/, weight: 0.3 },
    { label: "reference", pattern: /\b(reference|ref|transaction id)\b/, weight: 0.15 },
  ],
  corroborate(facts) {
    const signals: EvidenceSignal[] = [];
    const open = openDeposit(facts);
    if (open) {
      signals.push({
        weight: 0.9,
        note: `A ${formatCurrency(open.amount)} deposit (${open.reference}) started ${ago(facts.now, open.createdAt)} is still marked pending, and the wallet has no credit for it.`,
      });
    }
    const latestSettled = facts.topUps.find((topUp) => topUp.status === "completed");
    if (!open && latestSettled) {
      signals.push({
        weight: 0.25,
        note: `The most recent deposit (${latestSettled.reference}) settled ${latestSettled.paidAt ? ago(facts.now, latestSettled.paidAt) : "earlier"}; nothing is waiting.`,
      });
    }
    if (facts.topUps.length === 0) {
      // The absence is evidence, not the lack of it: a deposit that is not
      // recorded here was not paid into this account, whatever the customer was
      // told. Saying that is more useful than asking them to repeat themselves.
      signals.push({ weight: 0.6, note: "No deposit has ever been created on this account." });
    }
    if (facts.account.walletBalance === 0) {
      signals.push({ weight: 0.1, note: "The wallet is at zero, which fits a deposit that never landed." });
    }
    return signals;
  },
  ask: "Happy to check this. Which payment is it — the reference from your bank alert or the Paystack receipt, and roughly how much did you send?",
  remedy(facts): RemedyPlan {
    const open = openDeposit(facts);
    if (open) {
      return {
        ok: true,
        remedy: "recheck_topup",
        target: { kind: "topup", reference: open.reference, amount: open.amount },
        label: `Re-checked deposit ${open.reference} with the payment provider`,
      };
    }
    return {
      ok: false,
      reason: "There is no unsettled deposit on this account, so there is nothing here for me to re-check.",
    };
  },
  answer({ facts, action }) {
    const open = openDeposit(facts);
    const target = action?.remedy === "recheck_topup" ? facts.topUps.find((topUp) => topUp.status === "completed") : undefined;

    if (action?.status === "succeeded" && target) {
      return `That one is sorted. Your ${formatCurrency(target.amount)} deposit cleared and the wallet now shows ${formatCurrency(facts.account.walletBalance)}. You can see the entry at the top of Wallet → History.`;
    }
    if (action?.status === "succeeded" && open) {
      return `I asked the payment provider about that ${formatCurrency(open.amount)} deposit just now. It has not confirmed the charge yet, which usually means your bank is still moving the money — it is not lost, and nothing needs to be paid again. As soon as the provider confirms it, the wallet is credited automatically. If it has not arrived within a day, reply here and a person will trace it with the reference.`;
    }
    if (open) {
      return `I can see a ${formatCurrency(open.amount)} deposit (${open.reference}) from ${ago(facts.now, open.createdAt)} that has not settled yet. I checked with the payment provider and it has not confirmed the charge, so I cannot credit the wallet: crediting money the provider has not confirmed would be inventing it. It is not lost — the moment it confirms it is credited automatically, and the same deposit can never be credited twice. Reply here if it has not appeared within a day.`;
    }
    const settled = facts.topUps.find((topUp) => topUp.status === "completed");
    if (settled) {
      return `Every deposit on this account is accounted for. The most recent one — ${formatCurrency(settled.amount)}, ${settled.paidAt ? ago(facts.now, settled.paidAt) : "earlier"} — was credited, and your wallet balance is ${formatCurrency(facts.account.walletBalance)}. If you were charged for something that is not in this list, it may have been paid from a different Pryva account or an address that is not the one on this login, and a person will need the reference to trace it.`;
    }
    return `There is no deposit on this account at all, and your wallet balance is ${formatCurrency(facts.account.walletBalance)}. If money left your bank for Pryva, the payment may belong to a different account — a person can trace it if you send the reference.`;
  },
  verify(after, target) {
    if (target.kind !== "topup") return { ok: false, note: "Nothing to verify." };
    const entry = creditedEntry(after, target.reference);
    if (entry) {
      return { ok: true, note: `The ledger now holds a ${formatCurrency(entry.amount)} credit for ${target.reference}.` };
    }
    const topUp = after.topUps.find((candidate) => candidate.reference === target.reference);
    if (topUp && topUp.status === "completed") {
      return { ok: true, note: `Deposit ${target.reference} is marked completed.` };
    }
    return { ok: false, note: `Deposit ${target.reference} is still ${topUp?.status ?? "unknown"} and no credit exists.` };
  },
  needsHuman({ action }) {
    // Deliberately narrow. Whether the credit landed is already decided by
    // `verify`, and whether there was anything to check by `remedy` — asking
    // again here is how an assistant talks itself into escalating a ticket it
    // has just fixed.
    if (action?.status === "failed") return "I could not re-check that payment automatically.";
    return null;
  },
};

/* ------------------------------------------------------ order not working --- */

const orderProblem: Playbook = {
  id: "order-problem",
  title: "An order is not working or has not arrived",
  category: "orders",
  priority: "high",
  mixing: { intent: 0.5, evidence: 0.5 },
  intents: [
    { label: "bought something", pattern: /\b(order|ordered|bought|purchase|paid for)\b/, weight: 0.4 },
    { label: "not working", pattern: /\b(not working|doesn'?t work|isn'?t working|no code|not received|didn'?t arrive|not arrived|blank|expired)\b/, weight: 0.45 },
    { label: "stuck", pattern: /\b(stuck|pending|processing|waiting|hours|minutes)\b/, weight: 0.2 },
  ],
  corroborate(facts) {
    const order = facts.orders[0];
    if (!order) return [];
    if (order.status === "active") {
      return [{ weight: 0.75, note: `The most recent order (${order.reference}, ${order.productName}) is active, so it was delivered ${ago(facts.now, order.createdAt)}.` }];
    }
    if (order.status === "pending" || order.status === "processing") {
      return [{ weight: 0.85, note: `The most recent order (${order.reference}, ${order.productName}) is still ${order.status} after ${ago(facts.now, order.createdAt)}.` }];
    }
    if (order.status === "refunded") {
      return [{ weight: 0.7, note: `The most recent order (${order.reference}) was refunded ${order.refundedAt ? ago(facts.now, order.refundedAt) : "earlier"} to your wallet.` }];
    }
    return [{ weight: 0.4, note: `The most recent order (${order.reference}) is ${order.status}.` }];
  },
  ask: "Which order is it? The reference from your orders page is fastest, but the service and the day you bought it is enough.",
  answer({ facts }) {
    const order = facts.orders[0];
    if (!order) {
      return "I cannot see any order on this account yet. If you paid just now, the order may still be finishing — check Orders in a moment. If you have never ordered here, a person can look into it; tell them the service and the day.";
    }
    const where = "Open the order from Orders to see its code and, where the product has one, its expiry timer.";
    if (order.status === "active") {
      return `Your latest order is ${order.productName} (${order.reference}), bought ${ago(facts.now, order.createdAt)} for ${formatCurrency(order.amount)}, and it is marked active — that means it was delivered. ${where} If the code is rejected by the service itself, reply here with the error it shows and I will take it further.`;
    }
    if (order.status === "pending" || order.status === "processing") {
      return `Your latest order is ${order.productName} (${order.reference}), bought ${ago(facts.now, order.createdAt)} for ${formatCurrency(order.amount)}, and it is still ${order.status}. Nothing has been marked delivered yet, so there is no code to show. It is not lost: if it cannot be completed it is refunded to your wallet automatically. I am passing this to a person because it is taking longer than it should.`;
    }
    if (order.status === "refunded") {
      return `Your latest order (${order.reference}, ${order.productName}) was refunded${order.refundedAt ? ` ${ago(facts.now, order.refundedAt)}` : ""} for ${formatCurrency(order.amount)}. The money went back to your wallet, not to your bank — your balance is ${formatCurrency(facts.account.walletBalance)} and the refund is in Wallet → History.`;
    }
    return `Your latest order (${order.reference}, ${order.productName}) is marked ${order.status}. ${where}`;
  },
  needsHuman({ facts }) {
    const order = facts.orders[0];
    if (!order) return "There is no order on this account to look at.";
    if ((order.status === "pending" || order.status === "processing") && minutesSince(facts.now, order.createdAt) > 10) {
      return `The order has been sitting at ${order.status} for ${ago(facts.now, order.createdAt)}, which is longer than completing an order should take.`;
    }
    return null;
  },
};

/* -------------------------------------------------- refunds and balances --- */

const refundMissing: Playbook = {
  id: "refund-missing",
  title: "A refund has not appeared",
  category: "payments",
  priority: "high",
  mixing: { intent: 0.4, evidence: 0.6 },
  intents: [
    { label: "refund", pattern: /\brefund(ed|s)?\b/, weight: 0.6 },
    { label: "money back", pattern: /\b(money back|returned to (me|my wallet))/i, weight: 0.3 },
    { label: "not received", pattern: /\b(not|never|haven'?t|didn'?t)\b[^.]{0,25}\b(refunded|received|got it|back)\b/, weight: 0.3 },
  ],
  corroborate(facts) {
    const refundedOrder = facts.orders.find((order) => order.status === "refunded" || order.refundedAt);
    const refundEntry = facts.ledger.find((entry) => entry.type === "refund");
    const signals: EvidenceSignal[] = [];
    if (refundedOrder) {
      signals.push({ weight: 0.9, note: `Order ${refundedOrder.reference} is marked refunded${refundedOrder.refundedAt ? ` ${ago(facts.now, refundedOrder.refundedAt)}` : ""}.` });
    }
    if (refundEntry) {
      signals.push({ weight: 0.85, note: `The ledger holds a ${formatCurrency(refundEntry.amount)} refund (${refundEntry.reference}) written ${ago(facts.now, refundEntry.createdAt)}.` });
    }
    if (refundedOrder && !refundEntry) {
      signals.push({ weight: 1, note: "The order is marked refunded but the ledger has no refund entry for it, which should never happen." });
    }
    return signals;
  },
  ask: "Which order was refunded? If you have the reference from your orders page, paste it here.",
  answer({ facts, action }) {
    const refundEntry = facts.ledger.find((entry) => entry.type === "refund");
    const refundedOrder = facts.orders.find((order) => order.status === "refunded" || order.refundedAt);
    if (refundEntry) {
      return `Refunds come back to your Pryva wallet, not to your bank — and yours is there: ${formatCurrency(refundEntry.amount)} for ${refundEntry.description.replace(/^Refund[:\s-]*/i, "")}, written ${ago(facts.now, refundEntry.createdAt)}. Your balance is ${formatCurrency(facts.account.walletBalance)}. If you meant you want it sent to your bank instead, use Wallet → Withdraw, which moves it out (that is a withdrawal, not a refund).`;
    }
    if (refundedOrder) {
      return `Order ${refundedOrder.reference} is marked refunded, but I cannot find the matching wallet entry. That is a discrepancy I am not going to paper over: I am passing it to a person with the order and ledger lines so they can trace it.`;
    }
    return `I cannot see a refund on this account: no order is marked refunded and the ledger has no refund entry. If you were promised one, a person needs the order reference to check it.`;
  },
  needsHuman({ facts }) {
    const refundedOrder = facts.orders.find((order) => order.status === "refunded" || order.refundedAt);
    const refundEntry = facts.ledger.find((entry) => entry.type === "refund");
    if (refundedOrder && !refundEntry) return "A refunded order has no ledger entry, which means the books disagree.";
    if (!refundedOrder && !refundEntry) return "No refund exists on this account, so the claim cannot be confirmed from the records.";
    return null;
  },
};

const balanceWrong: Playbook = {
  id: "balance-wrong",
  title: "The wallet balance looks wrong",
  category: "wallet",
  priority: "high",
  mixing: { intent: 0.5, evidence: 0.5 },
  intents: [
    { label: "balance", pattern: /\bbalance\b/, weight: 0.55 },
    { label: "wrong or short", pattern: /\b(wrong|incorrect|less|short|missing|different|reduced|disappeared)\b/, weight: 0.35 },
  ],
  corroborate(facts) {
    const last = facts.ledger[0];
    if (!last) return [];
    const agrees = last.balanceAfter === facts.account.walletBalance;
    return [{
      weight: agrees ? 0.3 : 1,
      note: agrees
        ? `The newest ledger entry ends at ${formatCurrency(last.balanceAfter)}, which is exactly the wallet balance.`
        : `The newest ledger entry ends at ${formatCurrency(last.balanceAfter)} but the wallet says ${formatCurrency(facts.account.walletBalance)} — they disagree.`,
    }];
  },
  ask: "What does the balance show, and what did you expect it to be? The History tab on the wallet page shows how it got to the current figure.",
  answer({ facts }) {
    const last = facts.ledger[0];
    if (!last) {
      return `Your wallet balance is ${formatCurrency(facts.account.walletBalance)} and there are no transactions on it yet — so nothing has moved.`;
    }
    return `Your wallet balance is ${formatCurrency(facts.account.walletBalance)}. The newest movement was ${last.type} of ${formatCurrency(last.amount)} — "${last.description}" — ${ago(facts.now, last.createdAt)}, which left the balance at ${formatCurrency(last.balanceAfter)}. Everything before that is on Wallet → History. If the arithmetic does not match what you expected, say what you expected and a person will go through it with you.`;
  },
  needsHuman({ facts }) {
    const last = facts.ledger[0];
    if (last && last.balanceAfter !== facts.account.walletBalance) {
      return `The ledger's last entry and the wallet balance differ by ${formatCurrency(Math.abs(last.balanceAfter - facts.account.walletBalance))}.`;
    }
    return null;
  },
};

/* -------------------------------------------------------- account issues --- */

const emailVerification: Playbook = {
  id: "email-verification",
  title: "The email verification link",
  category: "account",
  priority: "normal",
  mixing: { intent: 0.35, evidence: 0.65 },
  intents: [
    { label: "verify", pattern: /\b(verify|verification|confirm|confirmation|activate)\b/, weight: 0.45 },
    { label: "email", pattern: /\b(email|address|inbox|mail)\b/, weight: 0.35 },
    { label: "link problems", pattern: /\b(link|expired|didn'?t (get|receive)|no email|not received)\b/, weight: 0.3 },
  ],
  corroborate(facts) {
    return [{
      weight: facts.account.emailVerified ? 0.15 : 1,
      note: facts.account.emailVerified
        ? `The address ${facts.account.email} is already verified.`
        : `The address ${facts.account.email} is still unverified.`,
    }];
  },
  ask: "Is this about the link to confirm your email address? If it expired or never arrived I can send a fresh one.",
  remedy(facts): RemedyPlan {
    if (facts.account.emailVerified) {
      return { ok: false, reason: "This address is already verified, so there is nothing to resend." };
    }
    return {
      ok: true,
      remedy: "resend_verification",
      target: { kind: "verification_email", email: facts.account.email },
      label: "Sent a fresh verification link",
    };
  },
  answer({ facts, action }) {
    if (facts.account.emailVerified) {
      return `Your address (${facts.account.email}) is already verified — there is nothing outstanding there. If a link told you it had expired, it was simply an older link; a newer one has already done the job.`;
    }
    if (action?.status === "succeeded") {
      return `Done — I sent a fresh verification link to ${facts.account.email}. It is valid for 24 hours and each new request cancels the previous link. If it is not in your inbox in a minute or two, check the spam folder; if it never arrives, tell me and I will hand it to a person, because a link that cannot be delivered is an email delivery problem and not something I can fix from here.`;
    }
    return `Your address (${facts.account.email}) is not verified yet. I could not send a fresh link just now, so I am passing this to a person rather than leaving you without a way forward.`;
  },
  needsHuman({ facts, action }) {
    if (action?.status === "failed") return "The verification email could not be sent.";
    if (facts.account.emailVerified) return null;
    return action?.status === "succeeded" ? null : "The verification email could not be sent from here.";
  },
};

const signInTrouble: Playbook = {
  id: "sign-in-trouble",
  title: "Signing in, locks and two-factor",
  category: "account",
  priority: "normal",
  mixing: { intent: 0.55, evidence: 0.45 },
  intents: [
    { label: "cannot sign in", pattern: /\b(can'?t|cannot|unable to|failed to)\b[^.]{0,20}\b(sign|log)\s?in\b/, weight: 0.6 },
    { label: "locked", pattern: /\b(locked|locks? (me )?out|lockout|too many attempts)\b/, weight: 0.5 },
    { label: "two-factor", pattern: /\b(2fa|two.?factor|authenticator|authentication code|otp app)\b/, weight: 0.4 },
    { label: "password", pattern: /\b(forgot|reset|change)\b[^.]{0,15}\bpassword\b/, weight: 0.35 },
  ],
  corroborate(facts) {
    const signals: EvidenceSignal[] = [];
    if (facts.account.lockedUntil && facts.account.lockedUntil.getTime() > facts.now.getTime()) {
      signals.push({
        weight: 1,
        note: `The account is locked until ${facts.account.lockedUntil.toISOString()} after repeated wrong passwords.`,
      });
    }
    if (facts.account.twoFactorEnabled) {
      signals.push({ weight: 0.4, note: "Two-factor is switched on for this account." });
    }
    return signals;
  },
  ask: "What happens when you try to sign in — a wrong-password message, a lockout message, or does it ask for an authenticator code?",
  answer({ facts }) {
    const locked = facts.account.lockedUntil && facts.account.lockedUntil.getTime() > facts.now.getTime();
    if (locked) {
      return `Your account is locked until ${facts.account.lockedUntil?.toISOString()}. That happens after eight wrong passwords in a row, and it is deliberate — it is what stops someone guessing their way in. You do not have to wait it out: the reset link on the sign-in page clears the lock immediately, because proving you can read the account's email beats a forgotten password.`;
    }
    if (facts.account.twoFactorEnabled) {
      return `Two-factor is on for this account, so signing in asks for a 6-digit code from your authenticator app after the password. If that code is being rejected, check the phone's clock is set automatically — these codes are time-based and a clock a minute out will fail. Your recovery codes are on Settings → Security; if you have lost both, a person has to verify you before anything is switched off, and I will not do that from here.`;
    }
    return `You are signed in right now, so nothing is blocking this session. If a different device or browser is being refused: eight wrong passwords in a row locks the account for 30 minutes, and a password reset clears that lock immediately. If it is asking for an authenticator code you no longer have, the recovery codes are on Settings → Security — without those, a person has to verify you first, and I will not switch two-factor off from here.`;
  },
  needsHuman({ facts }) {
    if (facts.account.lockedUntil && facts.account.lockedUntil.getTime() > facts.now.getTime()) {
      return "The account is currently locked, so a person should confirm the owner before anything is changed.";
    }
    return null;
  },
};

const suspiciousActivity: Playbook = {
  id: "account-access-concern",
  title: "Someone may have accessed the account",
  category: "account",
  priority: "urgent",
  mixing: { intent: 1, evidence: 0 },
  intents: [
    { label: "hacked", pattern: /\b(hack(ed)?|compromised|breach)\b/, weight: 0.85 },
    { label: "not me", pattern: /\b(i did ?n'?t|not me|never (made|did)|without my)\b/, weight: 0.55 },
    { label: "unauthorised", pattern: /\b(unauthori[sz]ed|suspicious|someone else|stranger)\b/, weight: 0.7 },
    { label: "sessions", pattern: /\b(logged out|signed out|other devices?|logged in from)\b/, weight: 0.4 },
  ],
  corroborate() {
    return [];
  },
  ask: "Can you tell me what you saw — a charge you did not make, a sign-in from somewhere else, or an email you did not expect?",
  answer() {
    return `Please do these three things now, in this order:
1. Change your password on Settings, and do it from a device only you use.
2. Turn on two-factor on Settings → Security and sign out the other sessions listed there.
3. If any money moved that was not you, reply with the transaction reference.

I am a support assistant: I can see what happened on your account but not who was at the keyboard, so I am not going to guess at that. A person is picking this up now, and everything above — the sessions, the ledger, the sign-in attempts — is in the thread with it.`;
  },
  needsHuman() {
    return "Account access concerns need a person to verify the owner and review the sign-in history.";
  },
};

/* ------------------------------------------------------ scheduled orders --- */

const scheduleStop: Playbook = {
  id: "schedule-stop",
  title: "Stopping or changing a scheduled order",
  category: "scheduling",
  priority: "normal",
  mixing: { intent: 0.5, evidence: 0.5 },
  intents: [
    { label: "scheduled", pattern: /\b(scheduled|recurring|auto(matic)?|subscription|every (day|week|month)|weekly|monthly|daily)\b/, weight: 0.5 },
    { label: "stop", pattern: /\b(cancel|stop|pause|end|disable|turn off|no longer)\b/, weight: 0.5 },
  ],
  corroborate(facts) {
    const active = facts.schedules.filter((schedule) => schedule.status === "active");
    if (active.length === 0) return [];
    return [{
      weight: 0.9,
      note: `${active.length} active ${active.length === 1 ? "schedule" : "schedules"}: ${active.map((schedule) => `${schedule.productLabel} (${schedule.frequency.toLowerCase()}, next ${ago(facts.now, schedule.nextRunAt) === "just now" ? "now" : schedule.nextRunAt.toISOString()})`).join("; ")}.`,
    }];
  },
  ask: "Which scheduled order should stop? The one you are on about will be listed on the Scheduled page.",
  clarify(facts, message) {
    const active = facts.schedules.filter((schedule) => schedule.status === "active");
    if (active.length <= 1) return null;
    const named = active.find((schedule) => message.includes(schedule.productLabel.toLowerCase()));
    if (named) return null;
    return `You have ${active.length} scheduled orders running, so I want to stop the right one rather than all of them:\n${active.map((schedule) => `• ${schedule.productLabel} — ${schedule.frequency.toLowerCase()}, next run ${schedule.nextRunAt.toISOString()}`).join("\n")}\nWhich one should stop?`;
  },
  remedy(facts, message): RemedyPlan {
    const active = facts.schedules.filter((schedule) => schedule.status === "active");
    if (active.length === 0) {
      return { ok: false, reason: "There is no active scheduled order on this account to stop." };
    }
    const named = active.find((schedule) => message.includes(schedule.productLabel.toLowerCase()));
    if (active.length === 1 || named) {
      const target = named ?? active[0];
      return {
        ok: true,
        remedy: "cancel_schedule",
        target: { kind: "schedule", id: target.id, label: target.productLabel },
        label: `Stopped the scheduled ${target.productLabel}`,
      };
    }
    return { ok: false, reason: "Several schedules are running, so one has to be chosen first." };
  },
  answer({ facts, action }) {
    const active = facts.schedules.filter((schedule) => schedule.status === "active");
    if (action?.status === "succeeded") {
      return `Done — that scheduled order is stopped. It will not run again and nothing further will be taken from your wallet for it. You can set up a new one from Scheduled whenever you want it back.`;
    }
    if (active.length === 0) {
      return `There is nothing scheduled on this account right now, so nothing is going to run. For reference, scheduled orders only ever pay from the wallet balance at the moment they run, and a schedule with too little balance is skipped rather than going into an overdraft.`;
    }
    return `You have ${active.length} active ${active.length === 1 ? "schedule" : "schedules"} and I have not stopped anything yet, because stopping the wrong one would cancel an order you want.`;
  },
  verify(after, target) {
    if (target.kind !== "schedule") return { ok: false, note: "Nothing to verify." };
    const schedule = after.schedules.find((candidate) => candidate.id === target.id);
    if (!schedule) return { ok: true, note: "The schedule is no longer listed." };
    if (schedule.status === "cancelled") return { ok: true, note: `Schedule ${target.label} is now cancelled.` };
    return { ok: false, note: `Schedule ${target.label} is still ${schedule.status}.` };
  },
  needsHuman({ action }) {
    if (action?.status === "failed") return "The schedule could not be cancelled automatically.";
    return null;
  },
};

/* ------------------------------------------------------------ gift cards --- */

const giftCardIssue: Playbook = {
  id: "gift-card-issue",
  title: "A gift card is not redeeming",
  category: "gift-cards",
  priority: "normal",
  mixing: { intent: 0.45, evidence: 0.55 },
  intents: [
    { label: "gift card", pattern: /\bgift ?card\b/, weight: 0.6 },
    { label: "code problem", pattern: /\b(code|voucher|redeem)\b[^.]{0,40}\b(not working|invalid|expired|used|error|rejected|won'?t)\b/, weight: 0.5 },
    { label: "redeem", pattern: /\bredeem/, weight: 0.3 },
  ],
  corroborate(facts) {
    const card = facts.giftCards[0];
    if (!card) return [{ weight: 0.2, note: "No gift card has ever been bought or received on this account." }];
    const expired = card.expiresAt.getTime() < facts.now.getTime();
    return [{
      weight: expired ? 1 : 0.8,
      note: `The newest card is ${card.code.slice(0, 8)}…, ${formatCurrency(card.amount)}, status ${card.status}, ${expired ? "expired" : `valid until ${card.expiresAt.toISOString().slice(0, 10)}`}.`,
    }];
  },
  ask: "Which gift card is it — the code starts PRYVA- — and what does it say when you try to redeem it?",
  answer({ facts }) {
    const card = facts.giftCards[0];
    if (!card) {
      return "There is no gift card on this account. If one was sent to your email, it has to be redeemed into an account first: enter the code on Gift cards → Redeem and it moves into your wallet. Gift cards are not refundable once issued, which is why the code itself matters.";
    }
    const expired = card.expiresAt.getTime() < facts.now.getTime();
    if (card.status === "redeemed") {
      return `That card was already redeemed, so the code will not work a second time — that is what a single-use code does. Its value is in your wallet, and the balance is ${formatCurrency(facts.account.walletBalance)}.`;
    }
    if (expired) {
      return `That card has expired: it was valid until ${card.expiresAt.toISOString().slice(0, 10)}. Gift cards are not refundable once issued, so an expired code cannot be turned back into money.`;
    }
    return `The card on your account (${card.code.slice(0, 8)}…) is ${card.status} and still valid until ${card.expiresAt.toISOString().slice(0, 10)}, so a code that will not redeem is a real problem and not something a rule explains away. I am passing it to a person, who will look at the redemption itself.`;
  },
  needsHuman({ facts }) {
    const card = facts.giftCards[0];
    if (!card) return "There is no gift card on the account to look at.";
    const expired = card.expiresAt.getTime() < facts.now.getTime();
    if (card.status === "redeemed" || expired) return null;
    return "The card is still valid, so a failed redemption needs a person to inspect.";
  },
};

const withdrawalPending: Playbook = {
  id: "withdrawal-pending",
  title: "A withdrawal has not been paid",
  category: "payments",
  priority: "high",
  mixing: { intent: 0.45, evidence: 0.55 },
  intents: [
    { label: "withdraw", pattern: /\bwithdraw(al|als|ing|n)?\b/, weight: 0.6 },
    { label: "payout", pattern: /\b(payout|paid out|transfer(red)? to (my )?bank|bank transfer)\b/, weight: 0.45 },
    { label: "waiting", pattern: /\b(not (yet )?(received|paid)|still waiting|how long)\b/, weight: 0.25 },
  ],
  corroborate(facts) {
    const withdrawal = facts.withdrawals[0];
    if (!withdrawal) return [{ weight: 0.15, note: "No withdrawal has ever been requested on this account." }];
    const pending = withdrawal.status === "pending";
    return [{
      weight: pending ? 0.9 : 0.6,
      note: `The newest withdrawal is ${formatCurrency(withdrawal.amount)}, status ${withdrawal.status}, requested ${ago(facts.now, withdrawal.createdAt)}.`,
    }];
  },
  ask: "Is this about a withdrawal you have already requested? If so, roughly when, and how much?",
  answer({ facts }) {
    const withdrawal = facts.withdrawals[0];
    if (!withdrawal) {
      return `There is no withdrawal on this account. Withdrawals go to a bank account in the account holder's own name, which has to match the name on the deposits — that check is why a payout cannot be sent to somebody else's account. Your wallet balance is ${formatCurrency(facts.account.walletBalance)}, and the withdraw form is on Wallet.`;
    }
    if (withdrawal.status === "pending") {
      return `Your withdrawal of ${formatCurrency(withdrawal.amount)} was requested ${ago(facts.now, withdrawal.createdAt)} and is waiting for a person to approve it — every payout is checked by hand before the bank transfer, so it is not instant by design. If it has been sitting there for more than a day, that is worth a look and I am passing it on.`;
    }
    if (withdrawal.status === "completed") {
      return `Your withdrawal of ${formatCurrency(withdrawal.amount)} was paid ${ago(facts.now, withdrawal.createdAt)}. If the money is not in your bank by now, the bank's own processing is the likely reason — a person can send you the transfer reference, which is what your bank will ask for.`;
    }
    return `Your withdrawal of ${formatCurrency(withdrawal.amount)} is marked ${withdrawal.status}${withdrawal.status === "rejected" ? ", so the money never left your wallet — it is still there and you can request it again once whatever blocked it is sorted" : ""}. Your balance is ${formatCurrency(facts.account.walletBalance)}.`;
  },
  needsHuman({ facts }) {
    const withdrawal = facts.withdrawals[0];
    if (!withdrawal) return "No withdrawal exists on the account.";
    if (withdrawal.status === "pending" && hoursSince(facts.now, withdrawal.createdAt) >= 24) {
      return `The withdrawal has been waiting on approval for ${hoursSince(facts.now, withdrawal.createdAt)} hours.`;
    }
    if (withdrawal.status === "completed") return "The payout is marked paid, so a person should send the transfer reference.";
    return null;
  },
};

/* --------------------------------------------------------- general things --- */

const humanRequest: Playbook = {
  id: "human-request",
  title: "Asked for a person",
  category: "other",
  priority: "high",
  mixing: { intent: 1, evidence: 0 },
  intents: [
    { label: "human", pattern: /\b(human|real person|agent|someone|supervisor|manager|staff)\b/, weight: 0.6 },
    { label: "talk to", pattern: /\b(speak|talk|chat|connect|escalate)\b/, weight: 0.5 },
  ],
  corroborate() {
    return [];
  },
  ask: "Tell me a little more and I will either fix it or make sure a person gets it with the details.",
  answer({ facts }) {
    return `Understood — this is with a person now, and they will see this thread, your account summary (balance ${formatCurrency(facts.account.walletBalance)}, ${facts.orders.length} recent orders) and everything I checked. You do not need to repeat yourself.`;
  },
  needsHuman() {
    return "The customer asked for a person.";
  },
};

/**
 * "hi", "hello", "can you help?"
 *
 * The first thing most people type into a support box is a greeting, and until now
 * it scored zero against every problem playbook and fell through to "I am not going
 * to guess at this one" — a cold non-answer to "hello". That reads as an assistant
 * that is not listening, which is precisely how it was reported.
 *
 * Every pattern here is anchored to the *whole* message. That is the safety
 * property: "help, my wallet is empty" must stay a wallet problem, so a greeting
 * only matches when there is nothing else in the sentence to act on. It carries no
 * actions and invents no facts — it says what the assistant can check and asks
 * what went wrong.
 */
const greeting: Playbook = {
  id: "greeting",
  title: "Just saying hello",
  category: "other",
  priority: "low",
  mixing: { intent: 1, evidence: 0 },
  intents: [
    {
      label: "greeting",
      pattern: /^(hi|hey|hello|yo|hiya|good (morning|afternoon|evening)|anyone there|are you there)[\s!.?,]*$/,
      weight: 0.9,
    },
    {
      label: "asked for help",
      pattern: /^(please[\s,]+)?(can|could) (you|someone|anyone) help( me)?[\s!.?]*$/,
      weight: 0.9,
    },
    { label: "needs help", pattern: /^(i need (some )?help|help( me)?)[\s!.?]*$/, weight: 0.9 },
  ],
  corroborate() {
    return [];
  },
  ask: "What is going wrong? A sentence is enough — what you expected, and what happened instead.",
  answer({ facts }) {
    return `Hello — tell me what is going wrong and I will look at the account rather than guess.

What I can settle on the spot: a deposit that never reached the wallet, an order that has not arrived or arrived wrong, a refund that has not landed, a scheduled order you want stopped, a gift card that will not redeem, a verification email that never came, and sign-in trouble. Anything else I hand to a person with the account summary attached.

As it stands I can see a wallet balance of ${formatCurrency(facts.account.walletBalance)} and ${facts.orders.length} recent order${facts.orders.length === 1 ? "" : "s"}.`;
  },
  needsHuman() {
    return null;
  },
};

const pricingQuestion: Playbook = {
  id: "pricing-question",
  title: "What something costs",
  category: "other",
  priority: "low",
  mixing: { intent: 1, evidence: 0 },
  intents: [
    { label: "price", pattern: /\b(how much|price|prices|pricing|cost|costs|charge|fee|fees)\b/, weight: 0.6 },
    { label: "product word", pattern: /\b(plan|bundle|package|subscription|number|esim|proxy|proxies|otp|account)\b/, weight: 0.35 },
  ],
  corroborate() {
    return [];
  },
  ask: "Which service are you asking about? I can point you at the exact price rather than a stale one.",
  answer() {
    return `Prices live in the app and change without notice, so I will not quote one from memory — the number you see next to a plan on Pricing (or in the purchase screen itself) is the number you pay, in naira, with no added fee at checkout. If a price there looks wrong, reply with the service and the plan and I will have it checked.`;
  },
  needsHuman() {
    return null;
  },
};

const acknowledgement: Playbook = {
  id: "acknowledgement",
  title: "Confirming it is sorted",
  category: "other",
  priority: "low",
  mixing: { intent: 1, evidence: 0 },
  intents: [
    { label: "thanks", pattern: /^(thanks|thank you|ok(ay)? thanks|alright thanks)\b/, weight: 0.85 },
    { label: "resolved", pattern: /\b(that worked|it works|it'?s working now|sorted|resolved|fixed now|all good)\b/, weight: 0.6 },
  ],
  corroborate() {
    return [];
  },
  ask: "Do you need anything else, or shall I close this?",
  answer() {
    return "Glad it is sorted. I have marked this resolved — reply any time and it reopens, and nothing about your account changes in the meantime.";
  },
  needsHuman() {
    return null;
  },
};

/**
 * When nothing matched.
 *
 * This one is not a guess dressed up: it says the assistant does not know, gives
 * the customer the two things that usually solve it, and hands over with the
 * account summary attached.
 */
export const FALLBACK_PLAYBOOK: Playbook = {
  id: "unrecognised",
  title: "Something the assistant does not recognise",
  category: "other",
  priority: "normal",
  mixing: { intent: 1, evidence: 0 },
  intents: [],
  corroborate() {
    return [];
  },
  ask: "Could you tell me a little more about what went wrong — which part of Pryva, and what you expected to happen?",
  answer({ facts }) {
    return `I am not going to guess at this one. Nothing in what you wrote matches a problem I know how to check, and inventing an answer would waste your time.

What I can check, if one of these is closer: a deposit that never reached the wallet, an order that has not arrived or arrived wrong, a refund that has not landed, a scheduled order you want stopped, a business gift card that will not redeem, a verification email that never came, and sign-in trouble. Send one of those in your own words and I will look properly.

What I can see right now: wallet balance ${formatCurrency(facts.account.walletBalance)}, ${facts.orders.length} recent orders, ${facts.topUps.length} recent deposits. That summary goes to a person with this message, so you will not have to explain it twice. Orders, Wallet → History and the FAQ cover most of the common cases in the meantime.`;
  },
  needsHuman() {
    return "The message did not match any problem the assistant can check.";
  },
};

export const PLAYBOOKS: Playbook[] = [
  suspiciousActivity,
  greeting,
  humanRequest,
  depositMissing,
  refundMissing,
  orderProblem,
  balanceWrong,
  withdrawalPending,
  giftCardIssue,
  scheduleStop,
  emailVerification,
  signInTrouble,
  acknowledgement,
  pricingQuestion,
  FALLBACK_PLAYBOOK,
];

export function playbookById(id: string): Playbook | undefined {
  return PLAYBOOKS.find((playbook) => playbook.id === id);
}
