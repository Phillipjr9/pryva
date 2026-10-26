import { requireAdmin } from "@/lib/auth";
import { WithdrawalsManager } from "./WithdrawalsManager";

export const dynamic = "force-dynamic";

export default async function AdminWithdrawalsPage() {
  await requireAdmin();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.5rem] font-medium tracking-tight">Withdrawal Requests</h1>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          Review, approve, and process user withdrawal requests.
        </p>
      </div>

      <WithdrawalsManager />
    </div>
  );
}
