import { checkPayoutDestination } from "@/lib/withdrawal-name-check";

/**
 * Whether a payout to this account name would be refused right now.
 *
 * One place answers the question for the review queue and for the customer-facing
 * warning, so the operator sees exactly the decision the payout route will make.
 */
export async function payoutDestinationBlocked(userId: string, accountName: string): Promise<boolean> {
  const check = await checkPayoutDestination(userId, accountName);
  return !check.ok;
}
