/**
 * Payment crediting — one code path for both the webhook and the browser
 * callback.
 *
 * Two things matter here and both are enforced below:
 *   1. Idempotency — a reference may only ever credit a wallet once, no matter
 *      how many times Paystack retries the webhook or the user refreshes the
 *      callback page.
 *   2. Bounded amounts — a webhook body is attacker-controlled until the
 *      signature check passes, and even then it must line up with what we allow.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { walletTransactions } from "@/db/schema";
import { creditWallet } from "@/lib/wallet";
import { logger } from "@/lib/logger";

export const MAX_TOPUP_NGN = 10_000_000;
const REFERENCE_MAX = 40;

export type CreditResult = { credited: boolean; reason?: string; balance?: number };

/** Has this provider reference already been applied to a wallet? */
export async function isReferenceCredited(reference: string): Promise<boolean> {
  if (!reference) return true;

  const existing = await db.query.walletTransactions.findFirst({
    where: eq(walletTransactions.reference, reference.slice(0, REFERENCE_MAX)),
    columns: { id: true },
  });

  return Boolean(existing);
}

/**
 * Credit a top-up exactly once.
 *
 * @param reference Paystack transaction reference (the idempotency key)
 * @param amountNgn amount in Naira — callers must convert from kobo first
 * @param userId the wallet owner
 */
export async function creditTopUpOnce(input: {
  reference: string;
  amountNgn: number;
  userId: string;
  description?: string;
}): Promise<CreditResult> {
  const reference = input.reference.slice(0, REFERENCE_MAX);
  const amount = Math.round(input.amountNgn);

  if (!reference) return { credited: false, reason: "missing_reference" };
  if (!Number.isFinite(amount) || amount < 100) return { credited: false, reason: "amount_too_small" };
  if (amount > MAX_TOPUP_NGN) return { credited: false, reason: "amount_too_large" };

  if (await isReferenceCredited(reference)) {
    logger.info("Top-up reference already credited — skipping", { reference, userId: input.userId });
    return { credited: false, reason: "already_credited" };
  }

  const balance = await creditWallet({
    userId: input.userId,
    amount,
    type: "credit",
    description: input.description ?? "Wallet top-up",
    reference,
  });

  logger.info("Wallet credited", { reference, userId: input.userId, amount, balance });
  return { credited: true, balance };
}
