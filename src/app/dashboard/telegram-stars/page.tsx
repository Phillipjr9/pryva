import Link from "next/link";
import { requireUser } from "@/lib/identity/auth";
import { starsSalesConfigured } from "@/lib/services/foxreload/stars-orders";
import { financialActionsUnavailable } from "@/lib/platform/financial-environment";
import { TelegramProducts } from "./TelegramProducts";

export const dynamic = "force-dynamic";
export default async function TelegramStarsPage() {
  const user = await requireUser("/dashboard/telegram-stars");
  return <div className="grid min-w-0 gap-4">
    <Link href="/dashboard/services?category=topups" className="w-fit text-meta font-semibold text-lav-700 hover:underline">← Account top-ups</Link>
    <div className="flex min-w-0 items-start gap-3 sm:gap-4">
      <div className="min-w-0">
        <p className="text-micro font-bold uppercase tracking-[0.16em] text-lav-700">Account top-up</p>
        <h1 className="mt-1 text-[1.6rem] font-semibold leading-tight text-ink sm:text-[1.9rem]">Telegram</h1>
        <p className="mt-1.5 max-w-2xl text-[0.8125rem] leading-relaxed text-ink-2">Send Stars or explore Premium for a Telegram username. Confirm the recipient carefully before paying.</p>
      </div>
    </div>
    <TelegramProducts userId={user.id} available={!financialActionsUnavailable() && starsSalesConfigured()} />
  </div>;
}
