import { requireAdmin } from "@/lib/identity/auth";
import { PayoutNameManager } from "./PayoutNameManager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payout names" };

/** The three things an operator has to hold in mind while working this queue. */
const RULES = [
  {
    title: "Payouts go to the funding name",
    body: "Money only leaves to a bank account matching the name frozen on the first settled deposit.",
  },
  {
    title: "Approving widens one customer",
    body: "It lets that one customer be paid to the reviewed name. It never edits the depositor record.",
  },
  {
    title: "Check the evidence first",
    body: "A bank statement, a matched BVN name, or a support thread tying both names to one person.",
  },
];

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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[1.5rem] font-medium tracking-tight">Payout names</h1>
          <p className="mt-1 max-w-2xl text-[0.86rem] leading-relaxed text-ink-2">
            Saved accounts the depositor-name rule would refuse. Approve a name to let one customer be
            paid to it, or revoke to put the rule back.
          </p>
        </div>
        <span className="rounded-full bg-lav-50 px-3 py-1 text-meta font-semibold uppercase tracking-[0.1em] text-lav-800">
          Money movement
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {RULES.map((rule) => (
          <div key={rule.title} className="rounded-xl border border-line bg-cream/40 px-4 py-3">
            <p className="text-meta font-semibold text-ink">{rule.title}</p>
            <p className="mt-1 text-meta leading-relaxed text-ink-2">{rule.body}</p>
          </div>
        ))}
      </div>

      <PayoutNameManager />
    </div>
  );
}
