/**
 * Closing an account, and what remains after it is closed.
 *
 * The request is simple — "let people delete their account" — and the hard part is
 * the second half of it: the record of what that account *did* has to survive. A
 * chargeback can arrive six months later; a delivery dispute reads the order that
 * caused it; fraud review needs the accounts that shared a network. A cascading
 * `DELETE FROM users` would take the orders, the ledger, the withdrawals and the
 * payment records with it, and leave Pryva unable to answer any of those
 * questions. That is why the old endpoint answered `503` instead of doing it.
 *
 * So deletion here means **the person goes, the paperwork stays**:
 *
 *   • what identifies a human — name, email, password, Google subject, second
 *     factor, passkeys, sessions — is removed or replaced with a tombstone;
 *   • what records a transaction — orders, wallet ledger, deposits, withdrawals,
 *     gift cards, support messages, fraud signals, reviews — is untouched, still
 *     attached to the same (now nameless) row;
 *   • `users.deleted_at` is the switch every auth path reads, so the account can
 *     never be used again.
 *
 * The rules that can be pure are pure, and this module is where they live, so both
 * the route and the screen that warns the customer speak from one definition. The
 * screen matters as much as the endpoint: somebody about to close their account is
 * entitled to see, before they press the button, exactly what is deleted and what
 * is kept, and why.
 */

/** How recently the person must have signed in to close the account. */
export const FRESH_SESSION_MS = 15 * 60 * 1000;

/** What the customer must type to confirm. Their own address — not a yes/no. */
export function confirmationMatches(typed: string | null | undefined, email: string): boolean {
  return typeof typed === "string" && typed.trim().toLowerCase() === email.trim().toLowerCase();
}

/**
 * The address a closed account keeps.
 *
 * Unreachable on purpose (`.invalid` is reserved and can never resolve, so no mail
 * is silently dropped into a stranger's inbox if the domain is ever registered),
 * unique per account because the column is unique and because a support question
 * months later needs to land on the right row, and obviously not a person.
 */
export function tombstoneEmail(userId: string): string {
  return `deleted+${userId}@deleted.pryva.invalid`;
}

/** What replaces the person's name on any screen that still joins to this row. */
export const TOMBSTONE_NAME = "Deleted account";

/** Why a deletion cannot proceed right now. Both reasons protect the customer. */
export type DeletionBlock = {
  code: "BALANCE_REMAINING" | "WITHDRAWAL_IN_FLIGHT";
  error: string;
  /** Where the customer can fix it, so the refusal is actionable. */
  action: { label: string; href: string };
  /** Machine-readable detail for the screen (never money leaving the account). */
  detail?: { balance?: number; withdrawals?: number };
};

/**
 * Never take an account with money in it.
 *
 * A zero-balance requirement is not a technicality: deleting an account holding
 * ₦4,500 would leave the owner of that money with no way to ask for it, and Pryva
 * holding it. Withdrawing first costs one tap. The same applies to a withdrawal
 * already in flight — the payout would be sent to a bank account whose owner can
 * no longer sign in to see whether it arrived.
 */
export function deletionBlock(account: {
  walletBalance: number;
  pendingWithdrawals: number;
}): DeletionBlock | null {
  if (account.walletBalance > 0) {
    return {
      code: "BALANCE_REMAINING",
      error: `Your wallet still holds ₦${account.walletBalance.toLocaleString()}. Withdraw it before closing the account — we will not keep money belonging to a closed account.`,
      action: { label: "Withdraw my balance", href: "/dashboard/wallet" },
      detail: { balance: account.walletBalance },
    };
  }
  if (account.pendingWithdrawals > 0) {
    return {
      code: "WITHDRAWAL_IN_FLIGHT",
      error:
        "A withdrawal from this account is still being processed. Wait until it is settled, then close the account — otherwise you would have no way to see whether the money arrived.",
      action: { label: "Check my withdrawals", href: "/dashboard/wallet" },
      detail: { withdrawals: account.pendingWithdrawals },
    };
  }
  return null;
}

/**
 * What the customer is told **before** they confirm.
 *
 * Deliberately two lists rather than a paragraph: the question "is my order
 * history gone?" deserves a line of its own, and so does "is my card number
 * kept?". Everything here is also what the endpoint does — a test compares the
 * two, because a warning that overstates or understates what happens is worse
 * than none.
 */
export const DELETION_TERMS = {
  removed: [
    "Your name, email address and password",
    "Sign-in with Google, passkeys and two-factor",
    "Every signed-in device, including this one",
    "Unused verification and password-reset links",
  ],
  kept: [
    {
      what: "Orders, wallet history, deposits and withdrawals",
      why: "A bank or a payment provider can question a payment months later, and a chargeback is decided on this record.",
    },
    {
      what: "Payment and payout references",
      why: "Needed to trace money that left or reached the account, and to defend a dispute.",
    },
    {
      what: "Support conversations and review history",
      why: "So a question you already asked is not answered from scratch, and so moderation stays consistent.",
    },
    {
      what: "Fraud signals and security logs",
      why: "An account that closes is still part of the pattern that identifies abuse of the next one.",
    },
  ],
  /**
   * Said plainly, because it is the part people are surprised by: the *account*
   * is gone, the *person* is gone, the financial record is not.
   */
  summary:
    "Your account and everything that identifies you are removed. The records of what the account paid for and was paid are kept, without your name or email attached, for as long as the law and disputes require. You will not be able to sign in again, and this cannot be undone.",
} as const;

/**
 * What the deletion receipt records.
 *
 * Counts, never contents: enough for an auditor to see that the paperwork was
 * retained and untouched, without turning the receipt into a second copy of the
 * customer's history.
 */
export function retentionSummary(counts: {
  orders: number;
  walletTransactions: number;
  deposits: number;
  withdrawals: number;
  giftCards: number;
  supportTickets: number;
  reviews: number;
}): Record<string, number> {
  return {
    orders: counts.orders,
    walletTransactions: counts.walletTransactions,
    deposits: counts.deposits,
    withdrawals: counts.withdrawals,
    giftCards: counts.giftCards,
    supportTickets: counts.supportTickets,
    reviews: counts.reviews,
  };
}

/** Whether the session that is asking is recent enough to close an account. */
export function sessionIsFresh(createdAt: Date | null | undefined, now = new Date()): boolean {
  if (!createdAt) return false;
  const age = now.getTime() - createdAt.getTime();
  // A clock skew that puts the session in the future is not "fresh": it is not
  // understood, and refusing costs one sign-in rather than an unexplained delete.
  return age >= 0 && age <= FRESH_SESSION_MS;
}
