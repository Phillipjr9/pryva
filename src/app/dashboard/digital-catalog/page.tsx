import Link from "next/link";
import { requireUser } from "@/lib/identity/auth";
import { DigitalCatalogBrowser } from "./DigitalCatalogBrowser";

export const dynamic = "force-dynamic";

export default async function DigitalCatalogPage() {
  await requireUser("/dashboard/digital-catalog");
  return (
    <div className="grid gap-5">
      <Link href="/dashboard/services" className="w-fit text-meta font-semibold text-lav-700 underline">← Service hub</Link>
      <div>
        <h1 className="text-[1.6rem] font-semibold text-ink">Explore digital products</h1>
        <p className="mt-2 text-[0.9rem] text-ink-2">Browse or search the digital catalogue, including subscriptions, gaming products, telecom and more.</p>
      </div>
      <div role="note" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-meta text-amber-900">
        These are listings for comparison only. Prices, coverage, delivery and ordering are not confirmed; no purchase can be made here.
      </div>
      <Link href="/dashboard/telegram-stars" className="w-fit rounded-xl border border-line bg-white px-4 py-3 font-semibold text-lav-700 hover:underline">Get a Telegram Stars quote →</Link>
      <Link href="/dashboard/digital-codes" className="w-fit rounded-xl border border-line bg-white px-4 py-3 font-semibold text-lav-700 hover:underline">Browse available digital codes and game keys →</Link>
      <Link href="/dashboard/digital-topups" className="w-fit rounded-xl border border-line bg-white px-4 py-3 font-semibold text-lav-700 hover:underline">Browse available account top-ups →</Link>
      <DigitalCatalogBrowser />
    </div>
  );
}
