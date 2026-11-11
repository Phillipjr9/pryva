import { redirect } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/identity/auth";
import { listedEsimOffers } from "@/lib/services/foxreload/esim-orders";
import { EsimPurchase } from "./EsimPurchase";
export const dynamic = "force-dynamic";
export default async function DigitalEsimsPage({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const user = await requireUser("/dashboard/digital-esims");
  const { product } = await searchParams;
  if (!product) redirect("/dashboard/services?category=esim");
  const offers = listedEsimOffers();
  return <div className="grid gap-5">
    <Link href="/dashboard/services?category=esim" className="w-fit text-meta font-semibold text-lav-700 underline">← eSIM</Link>
    <h1 className="text-[1.6rem] font-semibold text-ink">Travel eSIMs</h1>
    <p className="text-ink-2">Check device compatibility, coverage, validity and activation restrictions carefully. Current prices and availability are confirmed before payment.</p>
    <EsimPurchase userId={user.id} offers={offers} initialProduct={product} />
  </div>;
}
