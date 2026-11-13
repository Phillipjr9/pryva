import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  RESERVATION_STATUS,
  users,
  walletReservations,
  walletTransactions,
  type ReservationStatus,
} from "@/db/schema";
import { makeReference } from "@/lib/payments/wallet";
import type { OrderServiceTag } from "@/lib/services/registry";

/**
 * Durable wallet holds — the invariant every paid supplier call relies on.
 *
 * ## The race this exists to stop
 *
 * Every purchase route used to do the same three things in the same order: read
 * the signed-in balance, decide it was enough, call the supplier, and debit the
 * wallet afterwards. That is not a reservation. Two requests that arrive together
 * both read the same ₦50,000, both pass, and both spend — the supplier charges us
 * twice and only one debit can succeed. The order that lost the debit race is
 * recorded "delivered but uncharged", which is a real giveaway, and the supplier
 * invoice is real either way.
 *
 * A hold closes that by committing part of the balance before any supplier call,
 * atomically, in one UPDATE that checks availability and reserves it together:
 *
 *     wallet_reserved += amount                 -- the committed figure
 *     WHERE wallet_balance - wallet_reserved >= amount   -- availability, checked in the same statement
 *
 * The balance itself is deliberately left alone. `wallet_balance` is the ledger's
 * running figure and the nightly close walks `previous ± amount = balance_after`
 * across it; a hold that silently reduced it would look like a movement with no
 * ledger row and trip that check on every pending order. So the ledger stays
 * exactly as it was, and "available" is the derived number every spend path must
 * use: `wallet_balance - wallet_reserved`.
 *
 * Concurrent callers contend on the account row rather than on their own stale
 * reads: the second UPDATE sees the first one's result and is refused. A client
 * that sends the same `requestId` twice gets one hold, because
 * `(user_id, request_id)` is unique.
 *
 * ## The lifecycle
 *
 *   reserve  →  held  ──settle──→  settled (the hold becomes the real debit + ledger row)
 *                  ├──release──→  released (definitive supplier failure, nothing spent)
 *                  └──review───→  review   (outcome unknown: a human reconciles it)
 *
 * `wallet_reserved` is a derived total: it is only ever changed by the four
 * transitions in this module, each of which also moves `wallet_balance` where a
 * ledger row is written. The two are updated in the same statement, so a crash
 * cannot leave them disagreeing inside a committed transaction.
 *
 * ## The one thing every *other* spend path must do
 *
 * Because held money still sits in `wallet_balance`, a path that spends from
 * `wallet_balance` alone can eat into a hold, and the settle would then be short.
 * Every debit therefore checks availability, not the raw balance:
 * `debitWalletInTx` and the handful of hand-written debits (withdrawals, payouts,
 * gift cards, marketplace accounts) all subtract `wallet_reserved`. If a settle
 * is ever short despite that, it fails closed into `review` — never into a free
 * product and never into an automatic release.
 *
 * ## Why `review` never releases itself
 *
 * A timeout, a dropped connection, a 502 from a gateway and a supplier "maybe"
 * are indistinguishable from "we bought it". Releasing the hold there either
 * gives away a product we paid for (if it did buy) or strands the customer's
 * money until an operator looks. Parking it for review is the only answer that
 * is never wrong: money is not spent, nothing is retried, and the row says so.
 * There is deliberately no expiry sweep that releases `held` or `review` rows —
 * see `expiredHolds()` for the report the nightly job writes instead.
 *
 * ## What a caller must do
 *
 *   1. `reserveWallet()` — if it refuses, stop. Never call a supplier first.
 *   2. Call the supplier.
 *   3. Exactly one of `settleReservation` / `releaseReservation` /
 *      `holdForReview` on every code path that returns, **and** on the catch
 *      path. A row left `held` is money a customer cannot spend; it is visible in
 *      the nightly report, but the caller owns it.
 */

/** A price a caller may reserve. Whole naira, as the ledger stores it. */
const MAX_DATABASE_INTEGER = 2_147_483_647;

/** How long a hold is considered "live" for the operator report. Not a release. */
export const DEFAULT_HOLD_TTL_MS = 60 * 60 * 1000;

export type ReserveInput = {
  userId: string;
  /** The client's purchase-attempt key. Same key ⇒ same hold. */
  requestId: string;
  service: OrderServiceTag;
  amount: number;
  /** What is being bought: offer/plan id, price and terms. A mismatch is a conflict. */
  fingerprint: string;
  ttlMs?: number;
};

export type ReserveResult =
  /** Reserved now. `balance` is the spendable figure after the hold. */
  | { kind: "reserved"; reservationId: string; balance: number }
  /** This request already has a hold, and it matches. `open` means still held. */
  | {
      kind: "existing";
      reservationId: string;
      status: ReservationStatus;
      balance: number;
      orderId: string | null;
    }
  /** The request key exists but for different goods — never reuse it. */
  | { kind: "conflict"; reservationId: string; status: ReservationStatus }
  | { kind: "insufficient"; balance: number }
  | { kind: "ineligible" };

/**
 * Take a hold, atomically, or explain why not.
 *
 * Never call a supplier before this returns `reserved` (or `existing`/`settled`
 * for a replay of an attempt that already succeeded). The balance check and the
 * transfer of funds are one statement, so this cannot hand out more holds than
 * an account can cover however many requests arrive at once.
 */
export async function reserveWallet(input: ReserveInput): Promise<ReserveResult> {
  const { userId, requestId, service, amount, fingerprint } = input;
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_DATABASE_INTEGER) {
    throw new Error("A wallet hold must be a positive whole-naira amount");
  }
  if (fingerprint.length === 0 || fingerprint.length > 160) {
    throw new Error("A wallet hold needs a fingerprint of at most 160 characters");
  }
  const ttl = input.ttlMs ?? DEFAULT_HOLD_TTL_MS;

  // A retry must replay, not reserve twice. Read first so the common case costs
  // no write; the unique index still arbitrates a genuine race below.
  const existing = await findReservation(userId, requestId);
  if (existing) return existingResult(existing, fingerprint, service, userId);

  const reservationId = randomUUID();
  const expiresAt = new Date(Date.now() + ttl);

  const reserved = await db.transaction(async (tx) => {
    // Commit the funds first, checking availability in the same statement. If
    // this matches nothing, the account cannot cover the order and nothing
    // downstream may run.
    const [moved] = await tx
      .update(users)
      .set({ walletReserved: sql`${users.walletReserved} + ${amount}` })
      .where(
        and(
          eq(users.id, userId),
          sql`${users.walletBalance} - ${users.walletReserved} >= ${amount}`,
          isNull(users.suspendedAt),
          isNull(users.deletedAt),
        ),
      )
      .returning({
        balance: sql<number>`${users.walletBalance} - ${users.walletReserved}`,
      });

    if (!moved) return { kind: "ineligible-or-short" as const };

    try {
      await tx.insert(walletReservations).values({
        id: reservationId,
        userId,
        requestId,
        service,
        amount,
        status: RESERVATION_STATUS.held,
        fingerprint,
        expiresAt,
      });
    } catch (error) {
      // The unique index fired: a concurrent request with the same key reserved
      // first. Undo this one's movement by throwing, and let the loser read the
      // winner's row. Distinguishing this from a real write failure matters: only
      // the former is a replay.
      if (isUniqueViolation(error)) throw new DuplicateHold();
      throw error;
    }

    return { kind: "reserved" as const, balance: moved.balance };
  }).catch((error) => {
    if (error instanceof DuplicateHold) return { kind: "duplicate" as const };
    throw error;
  });

  if (reserved.kind === "duplicate") {
    const winner = await findReservation(userId, requestId);
    if (!winner) throw new Error("A concurrent hold vanished; nothing was spent");
    return existingResult(winner, fingerprint, service, userId);
  }

  if (reserved.kind === "ineligible-or-short") {
    // Tell "suspended" apart from "short", because the two need different words
    // and different next steps for the customer.
    const [account] = await db
      .select({
        available: sql<number>`${users.walletBalance} - ${users.walletReserved}`,
        suspendedAt: users.suspendedAt,
        deletedAt: users.deletedAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!account || account.suspendedAt || account.deletedAt) return { kind: "ineligible" };
    return { kind: "insufficient", balance: account.available };
  }

  return { kind: "reserved", reservationId, balance: reserved.balance };
}

class DuplicateHold extends Error {}

function isUniqueViolation(error: unknown): boolean {
  // Drizzle wraps driver errors; the pg code is on the cause chain, and the
  // message is the fallback for adapters that flatten it (PGlite and the
  // in-memory preview do not report a code).
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const record = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (record.code === "23505") return true;
    if (typeof record.message === "string" && /duplicate key value|unique constraint/i.test(record.message)) return true;
    current = record.cause;
  }
  return false;
}

async function findReservation(userId: string, requestId: string) {
  const [row] = await db
    .select()
    .from(walletReservations)
    .where(and(eq(walletReservations.userId, userId), eq(walletReservations.requestId, requestId)))
    .limit(1);
  return row ?? null;
}

async function existingResult(
  row: typeof walletReservations.$inferSelect,
  fingerprint: string,
  service: OrderServiceTag,
  userId: string,
): Promise<ReserveResult> {
  if (row.fingerprint !== fingerprint || row.service !== service) {
    // Same attempt key, different goods. Never reuse the hold: the customer
    // would be charged for one basket and shown another.
    return { kind: "conflict", reservationId: row.id, status: row.status };
  }
  return {
    kind: "existing",
    reservationId: row.id,
    status: row.status,
    balance: await availableBalance(userId),
    orderId: row.orderId,
  };
}

/**
 * Funds a customer can actually spend right now: the balance minus everything
 * held for a purchase that has not finished. Every customer-facing "you have X"
 * for a spend decision should be this number, not `wallet_balance`.
 */
export async function availableBalance(userId: string): Promise<number> {
  const [row] = await db
    .select({ available: sql<number>`${users.walletBalance} - ${users.walletReserved}` })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.available ?? 0;
}

/**
 * Turn a hold into the real debit, exactly once.
 *
 * The debit is written the way every other debit is — `wallet_balance` goes down
 * by the amount, a ledger row records the resulting balance — so the nightly
 * close still walks `previous ± amount = balance_after` with no special case for
 * held orders. The difference from an ordinary debit is where the *permission*
 * came from: the funds were committed at reserve time, so this cannot be refused
 * for want of availability, even an hour later while the order provisioned.
 *
 * The `held → settled` transition is conditional on the row still being `held`,
 * so two concurrent settles (a page load and the nightly sweep, say) settle once
 * and the loser is told the hold is already closed.
 *
 * If the arithmetic has somehow been eaten by a spend path that ignored
 * availability, this fails closed: the transaction rolls back, the hold stays
 * open, and the caller must park it for review. It never debits a negative
 * balance and never silently drops the charge.
 */
export async function settleReservation(input: {
  tx: any;
  reservationId: string;
  userId: string;
  amount: number;
  description: string;
  orderId?: string | null;
  reference: string;
  /**
   * Set by a path that already debited the wallet and only needs the hold
   * closed — a batch order debits every unit up front, before any supplier call.
   * It closes the reservation without moving money or writing a ledger row, so
   * one state machine covers both orders of operations instead of a second,
   * subtly different helper that a future edit could get wrong.
   *
   * Only correct where the debit and the hold were taken in the same
   * transaction; otherwise the money is not there to back the hold.
   */
  alreadyDebited?: boolean;
}): Promise<{ balance: number; reservationAlreadyClosed: boolean }> {
  const { tx } = input;

  const [closed] = await tx
    .update(walletReservations)
    .set({
      status: RESERVATION_STATUS.settled,
      settledAt: new Date(),
      updatedAt: new Date(),
      ...(input.orderId ? { orderId: input.orderId } : {}),
    })
    .where(
      and(
        eq(walletReservations.id, input.reservationId),
        eq(walletReservations.userId, input.userId),
        eq(walletReservations.status, RESERVATION_STATUS.held),
      ),
    )
    .returning({ amount: walletReservations.amount });

  if (!closed) {
    // Already settled (a replay), released, or parked for review. Report the
    // current balance and let the caller decide; never debit twice.
    const [current] = await tx
      .select({ balance: users.walletBalance })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    return { balance: current?.balance ?? 0, reservationAlreadyClosed: true };
  }

  if (closed.amount !== input.amount) {
    throw new Error("A wallet hold cannot be settled for a different amount than it reserved");
  }

  if (input.alreadyDebited) {
    // The money left the balance when the hold was taken under the batch path;
    // only the commitment remains to be undone.
    const [funds] = await tx
      .update(users)
      .set({ walletReserved: sql`${users.walletReserved} - ${input.amount}` })
      .where(and(eq(users.id, input.userId), sql`${users.walletReserved} >= ${input.amount}`))
      .returning({ balance: users.walletBalance });
    if (!funds) throw new Error("A wallet hold could not be settled: reserved total is short");
    return { balance: funds.balance, reservationAlreadyClosed: false };
  }

  // Release the commitment and take the money in one statement: availability is
  // `balance − reserved`, so dropping the reserve first and the balance second
  // would momentarily make the customer look richer than they are.
  const [funds] = await tx
    .update(users)
    .set({
      walletBalance: sql`${users.walletBalance} - ${input.amount}`,
      walletReserved: sql`${users.walletReserved} - ${input.amount}`,
    })
    .where(
      and(
        eq(users.id, input.userId),
        sql`${users.walletReserved} >= ${input.amount}`,
        sql`${users.walletBalance} >= ${input.amount}`,
      ),
    )
    .returning({ balance: users.walletBalance });

  if (!funds) {
    // The reserved total and the balance have to be able to cover this hold. If
    // they cannot, a spend path has broken the availability rule; surface it
    // rather than writing a ledger row against funds that are not there.
    throw new Error("A wallet hold could not be settled: funds are short");
  }

  await tx.insert(walletTransactions).values({
    userId: input.userId,
    orderId: input.orderId ?? null,
    type: "debit",
    amount: input.amount,
    balanceAfter: funds.balance,
    description: input.description.slice(0, 200),
    reference: input.reference,
  });

  return { balance: funds.balance, reservationAlreadyClosed: false };
}

/**
 * Give held funds back, exactly once, for an outcome that is definitively a
 * non-purchase.
 *
 * Nothing moves on the ledger: a released hold never appeared there in the first
 * place, so the customer's balance is already correct and only the commitment is
 * undone. That is why releasing cannot create money and why a double release is
 * harmless — the second attempt finds no `held` row and changes nothing.
 *
 * Only call this when the adapter has said *nothing was bought*. A timeout, an
 * ambiguous 5xx or an unknown status is not that: use `holdForReview`. Returning
 * money for an order the supplier accepted is how a customer receives a product
 * we paid for and keeps the cash.
 */
export async function releaseReservation(input: {
  tx: any;
  reservationId: string;
  userId: string;
  reason: string;
}): Promise<{ released: boolean; balance: number }> {
  const { tx } = input;

  const [closed] = await tx
    .update(walletReservations)
    .set({
      status: RESERVATION_STATUS.released,
      releasedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(walletReservations.id, input.reservationId),
        eq(walletReservations.userId, input.userId),
        eq(walletReservations.status, RESERVATION_STATUS.held),
      ),
    )
    .returning({ amount: walletReservations.amount });

  const [current] = await tx
    .select({ balance: users.walletBalance })
    .from(users)
    .where(eq(users.id, input.userId))
    .limit(1);

  if (!closed) return { released: false, balance: current?.balance ?? 0 };

  const [funds] = await tx
    .update(users)
    .set({ walletReserved: sql`${users.walletReserved} - ${closed.amount}` })
    .where(and(eq(users.id, input.userId), sql`${users.walletReserved} >= ${closed.amount}`))
    .returning({ balance: users.walletBalance });

  if (!funds) throw new Error("A wallet hold could not be released: reserved total is short");

  return { released: true, balance: funds.balance };
}

/**
 * Park the hold for a human because the supplier outcome is unknown.
 *
 * The funds stay reserved — the supplier may have taken them — and the row is
 * moved out of `held` so no path can settle or release it by accident. It is
 * listed by `expiredHolds()` and in the reconciliation queue until an operator
 * resolves it manually (`resolveReservation`).
 */
export async function holdForReview(input: {
  tx?: any;
  reservationId: string;
  userId: string;
  note: string;
}): Promise<boolean> {
  const runner = input.tx ?? db;
  const [moved] = await runner
    .update(walletReservations)
    .set({ status: RESERVATION_STATUS.review, updatedAt: new Date() })
    .where(
      and(
        eq(walletReservations.id, input.reservationId),
        eq(walletReservations.userId, input.userId),
        eq(walletReservations.status, RESERVATION_STATUS.held),
      ),
    )
    .returning({ id: walletReservations.id });
  return Boolean(moved);
}

/**
 * An operator's decision on a parked hold: either the supplier did deliver (settle
 * it) or it definitively did not (release it). Deliberately two explicit actions
 * rather than one "resolve", because one writes a debit and the other does not,
 * and an operator choosing between them is the entire point of the review.
 */
export async function resolveReviewedReservation(input: {
  reservationId: string;
  action: "settle" | "release";
  description: string;
}): Promise<{ balance: number; changed: boolean }> {
  const [row] = await db
    .select()
    .from(walletReservations)
    .where(
      and(
        eq(walletReservations.id, input.reservationId),
        eq(walletReservations.status, RESERVATION_STATUS.review),
      ),
    )
    .limit(1);
  if (!row) return { balance: 0, changed: false };

  if (input.action === "release") {
    // From review, not held: re-open it to held inside the transaction so the
    // shared release path's condition holds, then let it do the arithmetic.
    const result = await db.transaction(async (tx) => {
      const [reopened] = await tx
        .update(walletReservations)
        .set({ status: RESERVATION_STATUS.held, updatedAt: new Date() })
        .where(
          and(
            eq(walletReservations.id, input.reservationId),
            eq(walletReservations.status, RESERVATION_STATUS.review),
          ),
        )
        .returning({ id: walletReservations.id });
      if (!reopened) return { released: false, balance: 0 };
      return releaseReservation({
        tx,
        reservationId: input.reservationId,
        userId: row.userId,
        reason: input.description,
      });
    });
    return { balance: result.balance, changed: result.released };
  }

  const result = await db.transaction(async (tx) => {
    const [reopened] = await tx
      .update(walletReservations)
      .set({ status: RESERVATION_STATUS.held, updatedAt: new Date() })
      .where(
        and(
          eq(walletReservations.id, input.reservationId),
          eq(walletReservations.status, RESERVATION_STATUS.review),
        ),
      )
      .returning({ id: walletReservations.id });
    if (!reopened) return { balance: 0, reservationAlreadyClosed: true };
    return settleReservation({
      tx,
      reservationId: input.reservationId,
      userId: row.userId,
      amount: row.amount,
      description: input.description,
      orderId: row.orderId,
      reference: makeReference("PAY"),
    });
  });
  return { balance: result.balance, changed: !result.reservationAlreadyClosed };
}

/**
 * The open hold an order owns, if any — the funds its purchase committed.
 *
 * A refund path needs this: an order parked in `review` may still carry a hold,
 * and crediting the customer while it stays open would leave them with the refund
 * *and* an unspendable commitment of the same size, against an order they were
 * told had been refunded.
 */
export async function openHoldForOrder(orderId: string): Promise<{
  id: string;
  userId: string;
  amount: number;
  status: ReservationStatus;
} | null> {
  const [row] = await db
    .select({
      id: walletReservations.id,
      userId: walletReservations.userId,
      amount: walletReservations.amount,
      status: walletReservations.status,
    })
    .from(walletReservations)
    .where(
      and(
        eq(walletReservations.orderId, orderId),
        inArray(walletReservations.status, [RESERVATION_STATUS.held, RESERVATION_STATUS.review]),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Close a held or reviewed hold without moving money, for a refund that has
 * already credited the customer.
 *
 * The refund puts `amount` back on the balance, so the hold that was reserving
 * the same `amount` must go — otherwise the customer ends up with the refund
 * credit and an unspendable commitment of the same size, and the eventual
 * operator decision would debit them for an order they were told was refunded.
 * Deliberately narrow: it touches `wallet_reserved` only, and only for a hold
 * this order actually owns.
 */
export async function closeHoldForRefund(input: {
  tx: any;
  orderId: string;
}): Promise<{ closed: boolean; userId: string | null; amount: number }> {
  const [row] = await input.tx
    .update(walletReservations)
    .set({
      status: RESERVATION_STATUS.released,
      releasedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(walletReservations.orderId, input.orderId),
        inArray(walletReservations.status, [RESERVATION_STATUS.held, RESERVATION_STATUS.review]),
      ),
    )
    .returning({ amount: walletReservations.amount, userId: walletReservations.userId });

  if (!row) return { closed: false, userId: null, amount: 0 };

  const [funds] = await input.tx
    .update(users)
    .set({ walletReserved: sql`${users.walletReserved} - ${row.amount}` })
    .where(and(eq(users.id, row.userId), sql`${users.walletReserved} >= ${row.amount}`))
    .returning({ balance: users.walletBalance });
  if (!funds) throw new Error("A refund could not close the wallet hold: reserved total is short");

  return { closed: true, userId: row.userId, amount: row.amount };
}

export type StaleHold = {
  id: string;
  userId: string;
  service: string;
  amount: number;
  status: ReservationStatus;
  fingerprint: string;
  orderId: string | null;
  expiresAt: Date | null;
  createdAt: Date;
};

/**
 * Holds that outlived their TTL and are still open.
 *
 * This **reports**; it does not release. A hold that is still open means a path
 * returned without deciding, or is still inside a long supplier call. Releasing
 * it automatically would hand money back for an order the supplier may have
 * accepted, and settling it would charge for something nobody confirmed. The
 * nightly job counts these and names a bounded sample so an operator can decide.
 */
export async function expiredHolds(limit = 50, now = new Date()): Promise<StaleHold[]> {
  const rows = await db
    .select()
    .from(walletReservations)
    .where(
      and(
        inArray(walletReservations.status, [RESERVATION_STATUS.held, RESERVATION_STATUS.review]),
        lte(walletReservations.expiresAt, now),
      ),
    )
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    userId: row.userId,
    service: row.service,
    amount: row.amount,
    status: row.status,
    fingerprint: row.fingerprint,
    orderId: row.orderId,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  }));
}

/**
 * Every open hold for a customer: funds in the balance that are not spendable.
 *
 * A page that shows only `wallet_balance` while an order provisions is telling
 * the customer they have money they cannot use — which reads as a bug even when
 * the machinery is working. This is the figure that explains it, and it is what
 * the spend paths subtract.
 */
export async function openHolds(userId: string): Promise<{
  held: number;
  review: number;
  total: number;
  holdCount: number;
}> {
  const rows = await db
    .select({ amount: walletReservations.amount, status: walletReservations.status })
    .from(walletReservations)
    .where(
      and(
        eq(walletReservations.userId, userId),
        inArray(walletReservations.status, [RESERVATION_STATUS.held, RESERVATION_STATUS.review]),
      ),
    );
  let held = 0;
  let review = 0;
  for (const row of rows) {
    if (row.status === RESERVATION_STATUS.review) review += row.amount;
    else held += row.amount;
  }
  return { held, review, total: held + review, holdCount: rows.length };
}

/** Re-exported so a route can name the type without importing the schema module. */
export type { ReservationStatus };

/** Attach a claimed order id to a hold, so reconciliation can find both halves. */
export async function linkReservationToOrder(input: {
  tx?: any;
  reservationId: string;
  orderId: string;
}): Promise<void> {
  const runner = input.tx ?? db;
  await runner
    .update(walletReservations)
    .set({ orderId: input.orderId, updatedAt: new Date() })
    .where(eq(walletReservations.id, input.reservationId));
}
