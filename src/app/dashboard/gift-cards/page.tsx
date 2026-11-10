import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/identity/auth";
import { GiftCardsManager } from "./GiftCardsManager";

export const metadata: Metadata = { title: "Pryva gift cards" };
export const dynamic = "force-dynamic";

export default async function GiftCardsPage() {
  const user = await requireUser("/dashboard/gift-cards");
  return <main className="mx-auto max-w-4xl space-y-6">
    <div><h1 className="text-2xl font-bold text-ink">Pryva gift cards</h1>
      <p className="mt-2 text-sm text-ink-2">Send or redeem Pryva wallet credit and review your gift-card history. <Link className="font-semibold text-lav-700 underline" href="/dashboard/services?category=gift-cards">Browse other gift cards</Link>.</p></div>
    <GiftCardsManager user={user} brandSalesEnabled={false} initialTab="create" />
  </main>;
}
