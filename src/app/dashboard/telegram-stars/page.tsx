import Link from "next/link";
import { requireUser } from "@/lib/identity/auth";
import { StarsPurchase } from "./StarsPurchase";

export const dynamic = "force-dynamic";
export default async function TelegramStarsPage() {
  const user = await requireUser("/dashboard/telegram-stars");
  return <div className="space-y-5">
    <Link href="/dashboard/digital-catalog" className="text-meta font-semibold text-lav-700 underline">← Digital catalogue</Link>
    <div><h1 className="text-[1.6rem] font-semibold text-ink">Telegram Stars</h1><p className="mt-2 text-[0.9rem] text-ink-2">Send Stars to a Telegram username. Confirm the username carefully before paying.</p></div>
    <StarsPurchase userId={user.id} />
  </div>;
}
