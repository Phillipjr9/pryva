import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Book, Mail, MessageCircle } from "@/components/icons";

export const metadata: Metadata = {
  title: "Help Center",
  description: "Get help with your Pryva account, orders, and services.",
};

const categories = [
  { title: "Getting started", description: "Learn the basics and browse common questions.", icon: Book, links: [
    { label: "How Pryva works", href: "/how-it-works" },
    { label: "Frequently asked questions", href: "/faq" },
    { label: "Service status", href: "/status" },
  ] },
  { title: "Virtual numbers", description: "Learn about verification and protecting codes.", icon: MessageCircle, links: [
    { label: "Getting started with virtual numbers", href: "/blog/getting-started-virtual-numbers" },
    { label: "Account verification tips", href: "/blog/whatsapp-verification-tips" },
    { label: "Refund policy", href: "/refund-policy" },
  ] },
  { title: "eSIM and data", description: "Things to check before choosing a plan.", icon: Book, links: [
    { label: "eSIM travel checklist", href: "/blog/esim-travel-guide" },
    { label: "Frequently asked questions", href: "/faq" },
    { label: "Service status", href: "/status" },
  ] },
  { title: "Account and billing", description: "Find your wallet, policy and support resources.", icon: Mail, links: [
    { label: "Wallet and transaction history", href: "/dashboard/wallet" },
    { label: "Gift card guide", href: "/blog/gift-cards-for-teams" },
    { label: "Contact support", href: "/contact" },
  ] },
];

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-cream">
      <section className="py-16 sm:py-20">
        <div className="shell text-center">
          <h1 className="text-[2.5rem] font-medium tracking-tight text-ink sm:text-[3rem]">How can we help you?</h1>
          <p className="mx-auto mt-4 max-w-2xl text-[1.1rem] text-ink-2">Find guides, policies and support for your account and orders.</p>
        </div>
      </section>
      <section className="pb-16">
        <div className="shell grid gap-6 sm:grid-cols-2">
          {categories.map((category) => {
            const Icon = category.icon;
            return (
              <div key={category.title} className="rounded-2xl border border-line bg-white p-6">
                <div className="mb-4 flex items-start gap-4">
                  <div className="grid h-12 w-12 place-items-center rounded-xl bg-lav-100 text-lav-600"><Icon className="h-6 w-6" /></div>
                  <div><h2 className="text-[1.1rem] font-semibold text-ink">{category.title}</h2><p className="text-[0.86rem] text-ink-2">{category.description}</p></div>
                </div>
                <ul className="space-y-3">
                  {category.links.map((link) => <li key={link.href}><Link href={link.href} className="flex items-center gap-2 text-[0.86rem] text-ink-2 hover:text-lav-600"><ArrowRight className="h-3 w-3" />{link.label}</Link></li>)}
                </ul>
              </div>
            );
          })}
        </div>
      </section>
      <section className="pb-16">
        <div className="shell"><div className="rounded-2xl border border-line bg-white p-8 text-center">
          <h2 className="mb-3 text-[1.5rem] font-semibold text-ink">Still need help?</h2>
          <p className="mx-auto mb-6 max-w-md text-[0.95rem] text-ink-2">Contact support with your order or wallet reference.</p>
          <Link href="/contact" className="inline-flex items-center gap-2 rounded-xl bg-lav-600 px-6 py-3 text-[0.95rem] font-semibold text-white hover:bg-lav-700">Contact support <ArrowRight className="h-4 w-4" /></Link>
        </div></div>
      </section>
    </div>
  );
}
