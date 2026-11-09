import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { paymentTopups, payoutNameApprovals, TOPUP_STATUS } from "@/db/schema";

/**
 * The current payout rule compares a bank name with the profile name frozen at
 * the first completed top-up, or an independently reviewed approval. The
 * self-declared profile name is NOT proof of the actual payer's identity.
 * Independent verification and historical financial reconciliation remain
 * operational risks; do not describe this name match as verified funding identity.
 */

/**
 * Honorifics and titles that appear in bank records and customer-typed names but
 * carry no identity. Dropping them lets "Chief Ada Obi" match "ADA OBI" without
 * weakening anything: a title is not a name, and keeping it would refuse a
 * customer for the way their bank formatted their own account.
 */
const NON_NAME_TOKENS = new Set([
  "mr", "mrs", "ms", "miss", "dr", "prof", "chief", "hon", "sir", "madam",
  "alhaji", "hajia", "alh", "mallam", "pastor", "rev", "engr", "barr",
]);

/** Lowercase, unaccented, punctuation-free name tokens, without titles. */
export function normalizePayoutName(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .filter((token) => !NON_NAME_TOKENS.has(token));
}

export type PayoutNameCheck =
  | { ok: true }
  | { ok: false; reason: "no-deposit" | "no-name" | "mismatch" };

/**
 * Whether a destination account name may receive this user's money.
 *
 * Allowed when the two are the same name written out differently: the same
 * tokens in any order, with titles and accents ignored, and at most one extra
 * token for the middle name a bank record carries. Bank names arrive fuller than
 * what a signup form asked for and are usually surname-first in capitals, so
 * "Ada Obi" matches "ADA OBI", "OBI ADA", and "ADA OBI CHUKWUEMEKA".
 *
 * Refused otherwise, including the cases that matter:
 *   • "Ada Obi" vs "Bola Adeyemi"       — a different person entirely.
 *   • "Ada Obi" vs "Chinedu Obi"        — one shared surname is not identity.
 *   • "Ada Obi" vs "Ada Obinna"         — a near miss is still a different name.
 *   • "Ada Obi" vs "Ada"                — too little overlap to prove anything.
 *   • "Ada Obi" vs "Ada Obi Chukwu Obiora" — more than a middle name apart.
 *
 * The strictness is the point. Each refusal costs a support conversation; a
 * payout to the wrong person cannot be undone.
 */
export function comparePayoutNames(
  depositor: string | null | undefined,
  destination: string | null | undefined,
): PayoutNameCheck {
  if (typeof depositor !== "string" || !depositor.trim()) return { ok: false, reason: "no-deposit" };
  if (typeof destination !== "string" || !destination.trim()) return { ok: false, reason: "no-name" };

  const left = normalizePayoutName(depositor);
  const right = normalizePayoutName(destination);
  if (left.length === 0 || right.length === 0) return { ok: false, reason: "no-name" };

  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const shared = left.filter((token) => rightSet.has(token));

  const same = leftSet.size === rightSet.size && shared.length === leftSet.size;
  if (same) return { ok: true };

  // Otherwise the two must still be the same name written out differently: one
  // fully contained in the other, differing by at most a single extra token (the
  // middle name a bank record carries and a signup form did not ask for), and
  // overlapping in at least two tokens so that a shared surname alone can never
  // pass. Both conditions matter -- containment without the size limit would
  // accept "Ada Obi" against "Ada Obi Chukwu Obiora", and the overlap floor is
  // what refuses "Ada" against "Ada Obi".
  const contained = shared.length === Math.min(leftSet.size, rightSet.size);
  const oneExtraName = Math.abs(leftSet.size - rightSet.size) <= 1;
  if (contained && oneExtraName && shared.length >= 2) return { ok: true };

  return { ok: false, reason: "mismatch" };
}

/**
 * The name on this user's earliest settled deposit, or null when none carries
 * one.
 *
 * The earliest is used because it is the identity that opened the money trail;
 * a later deposit made after a profile rename must not become the new reference.
 * A null is not a match — it fails closed, so a wallet funded before migration
 * 0012 cannot be paid out on the strength of a name nobody recorded.
 */
export async function depositorNameFor(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ payerName: paymentTopups.payerName })
    .from(paymentTopups)
    .where(
      and(
        eq(paymentTopups.userId, userId),
        eq(paymentTopups.status, TOPUP_STATUS.completed),
        isNotNull(paymentTopups.payerName),
      ),
    )
    .orderBy(asc(paymentTopups.paidAt))
    .limit(1);
  return row?.payerName ?? null;
}

/**
 * A payout name an administrator has reviewed and approved for this account.
 *
 * Stored beside the frozen depositor name rather than replacing it: the record of
 * what was on the account when the money arrived is evidence, and a decision made
 * later must not erase it. Revoking the approval restores the original rule.
 */
export async function payoutApprovalFor(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ approvedName: payoutNameApprovals.approvedName })
    .from(payoutNameApprovals)
    .where(and(eq(payoutNameApprovals.userId, userId), isNull(payoutNameApprovals.revokedAt)))
    .orderBy(desc(payoutNameApprovals.createdAt))
    .limit(1);
  return row?.approvedName ?? null;
}

export type PayoutDestinationCheck =
  | { ok: true; matched: "depositor" | "approval" }
  | { ok: false; reason: PayoutNameReason };

/**
 * Whether this account may be paid, in either of the two ways it can qualify.
 *
 * Either the destination matches the name frozen on the funding deposit, or it
 * matches a name an administrator reviewed and approved for this account. The
 * frozen name is checked first because it needs no human in the loop; the
 * approval exists for the case that rule cannot answer — the same person whose
 * bank record is fuller than the signup form.
 */
export async function checkPayoutDestination(userId: string, accountName: string): Promise<PayoutDestinationCheck> {
  const depositorName = await depositorNameFor(userId);
  const depositorCheck = comparePayoutNames(depositorName, accountName);
  if (depositorCheck.ok) return { ok: true, matched: "depositor" };

  const approvedName = await payoutApprovalFor(userId);
  if (approvedName && comparePayoutNames(approvedName, accountName).ok) {
    return { ok: true, matched: "approval" };
  }

  return { ok: false, reason: depositorCheck.reason };
}

export type PayoutNameReason = Extract<PayoutNameCheck, { ok: false }>["reason"];

/** Wording shared by every surface that refuses a payout, so they agree. */
export const PAYOUT_NAME_MESSAGES: Record<PayoutNameReason, string> = {
  "no-deposit":
    "No profile name was recorded with a completed top-up. Contact support for a payout-name review.",
  "no-name":
    "That bank account has no name on record, so it cannot be paid. Verify it again before saving.",
  mismatch:
    "This bank account does not have the same name as the profile name recorded with your first completed top-up, so it cannot be used without review. If your bank spells your name differently — a fuller name, or surname first — contact support and ask for a payout-name review; a bank statement or an account screenshot showing the name is usually enough.",
};
