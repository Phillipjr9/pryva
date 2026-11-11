import { redirect } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/identity/auth";
import { listedTopupOffers } from "@/lib/services/foxreload/topup-orders";
import { TopupPurchase } from "./TopupPurchase";
export const dynamic = "force-dynamic";
export default async function DigitalTopupsPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const user = await requireUser("/dashboard/digital-topups");
  const { product } = await searchParams;
  if (!product) redirect("/dashboard/services?category=topups");
  const offers = listedTopupOffers();
  return <div className="grid gap-5">
    <Link href="/dashboard/services?category=topups" className="w-fit text-meta font-semibold text-lav-700 underline">← Account top-ups</Link>
    <h1 className="text-[1.6rem] font-semibold text-ink">Account top-ups</h1>
    <p className="text-ink-2">Check the product, region and recipient carefully. Never enter a password or verification code here.</p>
    <TopupPurchase userId={user.id} offers={offers} initialProduct={product} />
  </div>;
}
