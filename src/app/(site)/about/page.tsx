import type { Metadata } from "next";
import Link from "next/link";
import { Shield, Wallet, Globe } from "@/components/icons";

export const metadata: Metadata = {
  title: "About Pryva",
  description: "Learn about the Pryva digital-services application.",
};

const values = [
  { icon: Wallet, title: "Naira pricing", description: "Browse the catalog and review prices in Nigerian Naira." },
  { icon: Shield, title: "Order records", description: "Find wallet transactions and order references in your dashboard." },
  { icon: Globe, title: "Digital services", description: "Explore the available catalog and check service status before ordering." },
];

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-cream">
      <section className="py-16 sm:py-24">
        <div className="shell max-w-3xl text-center">
          <h1 className="text-4xl font-medium tracking-tight text-ink sm:text-5xl">About <span className="text-lav-600">Pryva</span></h1>
          <p className="mt-6 text-lg leading-8 text-ink-2">
            Pryva brings a wallet, order history and a digital-services catalog together in one application.
            Virtual numbers for SMS verification are delivered automatically, and every order is paid for in
            Naira from a balance you control. Categories we cannot yet deliver reliably are marked unavailable
            rather than sold.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            <Link href="/status" className="btn btn-primary">Check service status</Link>
            <Link href="/contact" className="btn btn-ghost">Contact support</Link>
          </div>
        </div>
      </section>
      <section className="pb-16"><div className="shell grid gap-6 sm:grid-cols-3">
        {values.map(({ icon: Icon, title, description }) => <div key={title} className="rounded-2xl border border-line bg-white p-6">
          <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-lav-100 text-lav-600"><Icon className="h-6 w-6" /></div>
          <h2 className="text-lg font-semibold text-ink">{title}</h2><p className="mt-2 text-sm leading-6 text-ink-2">{description}</p>
        </div>)}
      </div></section>
    </div>
  );
}
