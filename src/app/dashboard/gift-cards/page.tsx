import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { GiftCardsManager } from "./GiftCardsManager";

export default async function GiftCardsPage() {
  const user = await requireAuth();
  if (!user) redirect("/login?next=/dashboard/gift-cards");

  return (
    <DashboardShell user={user}>
      <div className="space-y-6">
        <div>
          <h1 className="text-[1.75rem] font-medium tracking-tight text-ink dark:text-gray-100">
            Gift Cards
          </h1>
          <p className="mt-2 text-[0.95rem] text-ink-2 dark:text-gray-400">
            Send Pryva credit to friends, family or team members.
          </p>
        </div>
        <GiftCardsManager user={user} />
      </div>
    </DashboardShell>
  );
}
