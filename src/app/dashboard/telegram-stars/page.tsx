import Link from "next/link";
import { requireUser } from "@/lib/identity/auth";
import { BrandIcon } from "@/components/BrandIcon";
import { starsSalesConfigured } from "@/lib/services/foxreload/stars-orders";
import { financialActionsUnavailable } from "@/lib/platform/financial-environment";
import { StarsPurchase } from "./StarsPurchase";

export const dynamic = "force-dynamic";
export default async function TelegramStarsPage() {
  const user = await requireUser("/dashboard/telegram-stars");
  return <div className="space-y-5">
    <Link href="/dashboard/digital-catalog" className="text-meta font-semibold text-lav-700 underline">← Digital catalogue</Link>
    <div className="flex items-start gap-4"><BrandIcon brand="telegram" size={56} decorative /><div><h1 className="text-[1.6rem] font-semibold text-ink">Telegram Stars</h1><p className="mt-2 text-[0.9rem] text-ink-2">Send Stars to a Telegram username. Confirm the username carefully before paying.</p></div></div>
    <StarsPurchase userId={user.id} available={!financialActionsUnavailable() && starsSalesConfigured()} />
  </div>;
}
