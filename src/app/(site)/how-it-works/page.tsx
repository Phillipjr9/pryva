import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Card, Shield, Sparkle, Wallet } from "@/components/icons";

export const metadata: Metadata = {
  title: "How it works",
  description: "Explore the Pryva dashboard, wallet and automatic number delivery.",
};

const steps = [
  { number: "01", title: "Create an account", icon: Wallet, body: "Sign up with a name, email and password, or use an available sign-in option. Password signup does not currently verify email ownership." },
  { number: "02", title: "Review the wallet", icon: Card, body: "Top up with Paystack by bank transfer or card. Your wallet is credited once the payment is confirmed, never before." },
  { number: "03", title: "Explore plans", icon: Sparkle, body: "Browse the catalog and review every price in Naira before you pay. Categories we cannot deliver reliably are marked unavailable." },
  { number: "04", title: "Keep your references", icon: Shield, body: "Check order and wallet history in the dashboard. If a delivery is uncertain, contact support with its reference before ordering again. Refunds are reviewed against the delivery outcome." },
];

export default function HowItWorksPage() {
  return (
    <div className="bg-cream py-16">
      <div className="shell max-w-3xl">
        <div className="text-center">
          <p className="eyebrow justify-center">How it works</p>
          <h1 className="mt-4 text-4xl font-medium tracking-tight text-ink sm:text-5xl">Explore Pryva, step by step.</h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-7 text-ink-2">See how the dashboard, wallet and number delivery work, start to finish.</p>
        </div>
        <div className="mt-10 grid gap-4">
          {steps.map(({ number, title, icon: Icon, body }) => <section key={number} className="flex gap-4 rounded-2xl border border-line bg-white p-6">
            <span className="text-display text-2xl text-lav-400">{number}</span>
            <div><h2 className="flex items-center gap-2 text-lg font-semibold text-ink"><Icon className="h-4 w-4 text-lav-600" />{title}</h2><p className="mt-2 leading-7 text-ink-2">{body}</p></div>
          </section>)}
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/status" className="btn btn-primary">Check service status <ArrowRight className="h-4 w-4" /></Link>
          <Link href="/pricing" className="btn btn-ghost">Explore pricing</Link>
          <Link href="/faq" className="btn btn-ghost">Read the FAQ</Link>
        </div>
      </div>
    </div>
  );
}
