import { requireAdmin } from "@/lib/auth";
import { WithdrawalsManager } from "./WithdrawalsManager";

export const dynamic = "force-dynamic";

export default async function AdminWithdrawalsPage() {
  await requireAdmin();
  const testMode = process.env.PAYSTACK_SECRET_KEY?.trim().startsWith("sk_test_") ?? false;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.5rem] font-medium tracking-tight">Withdrawal Requests</h1>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          Review withdrawal requests. The list and counts show at most the latest 200 matches. Paystack may require merchant authorization; verify the final status, amount and recipient before marking a transfer complete.
        </p>
      </div>

      {testMode && <p role="note" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><strong>Paystack test mode.</strong> Transfers are simulated. Use test recipients and a separate staging database.</p>}
      <WithdrawalsManager />
    </div>
  );
}
