import Link from "next/link";
import { requireUser } from "@/lib/identity/auth";
import { listedCodeOffers } from "@/lib/services/foxreload/code-orders";
import { CodePurchase } from "./CodePurchase";
export const dynamic = "force-dynamic";
export default async function DigitalCodesPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const user = await requireUser("/dashboard/digital-codes");
  const { product } = await searchParams;
  const offers = listedCodeOffers();
  return <div className="grid gap-5">
    <Link href="/dashboard/digital-catalog" className="w-fit text-meta font-semibold text-lav-700 underline">← Digital catalogue</Link>
    <h1 className="text-[1.6rem] font-semibold text-ink">Digital codes and game keys</h1>
    <p className="text-ink-2">Check the product and redemption region carefully. Current prices and availability are confirmed before payment.</p>
    <CodePurchase userId={user.id} offers={offers} initialProduct={product} />
  </div>;
}
