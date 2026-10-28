"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Lock, Wallet } from "@/components/icons";
import { formatNaira } from "@/lib/catalog";
import { PaymentLoading } from "@/components/ui/PaymentLoading";
import { PaymentSuccess } from "@/components/ui/PaymentSuccess";

type Props = { itemId: string; country: string; name: string; price: number; units: number; balance: number; stock: number; category: string };

export function DemoServiceCheckout({ itemId, country, name, price, units, balance, stock, category }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsFunds, setNeedsFunds] = useState(false);
  const [success, setSuccess] = useState<{ orderId: string; reference: string } | null>(null);
  const inFlight = useRef(false);
  const requestId = useRef<string | null>(null);

  async function purchase() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    setNeedsFunds(false);
    try {
      requestId.current ??= crypto.randomUUID();
      const [response] = await Promise.all([
        fetch("/api/demo/services/purchase", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId, country, requestId: requestId.current }),
        }),
        new Promise((resolve) => setTimeout(resolve, 1600)),
      ]);
      const data = await response.json() as { ok?: boolean; simulated?: boolean; orderId?: string; reference?: string; error?: string };
      if (!response.ok || !data.ok || !data.simulated || !data.orderId || !data.reference) {
        setError(data.error ?? "Could not complete the demo order. Check your orders before retrying.");
        setNeedsFunds(response.status === 402);
        return;
      }
      setSuccess({ orderId: data.orderId, reference: data.reference });
      router.refresh();
    } catch {
      setError("Could not confirm the demo order. Check your orders before retrying.");
    } finally {
      setPending(false);
      inFlight.current = false;
    }
  }

  return (
    <>
      <PaymentLoading show={pending} message="Preparing your demo order and updating your wallet…" />
      <PaymentSuccess show={!!success} title="Demo order complete" message={`${name} is ready in your simulated orders. No real service was purchased.`} redirectUrl={`/dashboard/orders/${success?.orderId ?? ""}`} redirectDelay={2500} />
      <div className="rounded-[1.5rem] border border-line bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-[0.65rem] font-bold uppercase tracking-[0.14em] text-lav-700">Your demo selection</p><h2 className="mt-1 text-[1.12rem] font-semibold text-ink">{name}</h2><p className="mt-1 text-[0.76rem] text-ink-3">{units} simulated unit{units === 1 ? "" : "s"} · {category === "social" ? "Fictional demo profile" : "Demo delivery"}</p></div>
          <p className="text-[1.55rem] font-semibold leading-none text-ink">{formatNaira(price)}</p>
        </div>
        <div className="mt-5 grid gap-2 rounded-xl bg-lav-50/70 p-4 text-[0.76rem] text-ink-2">
          <p className="flex items-center gap-2"><Wallet className="h-4 w-4 text-lav-700" /> Demo wallet balance: <strong>{formatNaira(balance)}</strong></p>
          <p className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-lav-700" /> {category === "social" ? "Watch a fictional promotion complete in your orders." : "See the demo delivery in your order details."}</p>
          <p className="flex items-start gap-2"><Lock className="mt-0.5 h-4 w-4 shrink-0 text-lav-700" /> No real payment or external service is involved.</p>
        </div>
        {error && <p role="alert" className="mt-4 text-[0.77rem] font-medium text-rose-700">{error} {needsFunds && <Link href="/dashboard/wallet" className="underline">Add demo funds</Link>}</p>}
        <button type="button" onClick={() => void purchase()} disabled={pending || stock < units || !!success} className="btn btn-primary mt-5 w-full !py-3.5 disabled:cursor-not-allowed disabled:opacity-50">
          {pending ? "Processing…" : stock < units ? "Demo stock exhausted" : `Pay ${formatNaira(price)} with demo wallet`} {!pending && <ArrowRight className="h-4 w-4" />}
        </button>
        {success && <p className="mt-3 text-center text-[0.68rem] text-ink-3">Reference {success.reference}</p>}
      </div>
    </>
  );
}
