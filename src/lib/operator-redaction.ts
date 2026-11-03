import "server-only";

/**
 * What the read credential is not shown.
 *
 * A console reading over `OPERATOR_READ_TOKEN` needs enough to recognise a payout
 * and argue about it, and none of the coordinates that could move money by
 * themselves. A Paystack recipient code is a reusable transfer target: whoever holds
 * it can pay into that account without the customer's bank details again. A full
 * account number leaves the platform with every row. The last four digits are what an
 * operator actually reads back over the phone, which is the same rule
 * `src/app/api/admin/payout-names/route.ts` already follows for its own listing.
 */
export function lastFour(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length <= 4 ? value : value.slice(-4);
}

type PayoutCoordinates = {
  accountNumber?: string | null;
  recipientCode?: string | null;
};

/** Keeps the row's shape; replaces the two fields that are not for a hosted reader. */
export function redactPayoutCoordinates<Row extends PayoutCoordinates>(row: Row): Row {
  return { ...row, accountNumber: lastFour(row.accountNumber), recipientCode: null };
}
