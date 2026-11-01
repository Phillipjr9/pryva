import { requireAdmin } from "@/lib/auth";
import { PayoutNameManager } from "./PayoutNameManager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payout names" };

/**
 * Where a refused payout becomes a decision rather than a dead end.
 *
 * A payout may only go to a bank account in the name that funded the wallet. When
 * the signup name is shorter than the bank record — "Emeka" against "EMEKA
 * CHUKWUEMEKA OKAFOR" — the customer is told to contact support, and this is what
 * support uses: the frozen depositor name, the accounts that are blocked, and a
 * field to record the reviewed name and why.
 */
export default async function AdminPayoutNamesPage() {
  await requireAdmin("/admin/payout-names");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.5rem] font-medium tracking-tight">Payout names</h1>
        <p className="mt-1 max-w-3xl text-[0.86rem] leading-relaxed text-ink-2">
          Payouts are only sent to a bank account whose name matches the name frozen on the
          customer&rsquo;s first settled deposit. This page lists saved accounts that rule would
          refuse. Approving a name here lets that one customer be paid to it; it never changes the
          depositor name on record, and it can be revoked. Check the evidence before approving —
          a bank statement, a matched BVN name, or a support conversation that ties the two names
          to the same person.
        </p>
      </div>

      <PayoutNameManager />
    </div>
  );
}
