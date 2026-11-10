import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Book, Mail, MessageCircle, Shield, Sparkle } from "@/components/icons";

export const metadata: Metadata = {
  title: "Help Center",
  description: "Get help with your PryvaLogs account, orders, wallets, eSIMs, and payouts.",
};

const quickActions = [
  { title: "Track an order", text: "Check delivery, status updates, and what to do if a number or eSIM is still pending.", href: "/dashboard/orders" },
  { title: "Wallet & payouts", text: "Check balances, recent wallet activity, and payout-name rules before a withdrawal.", href: "/dashboard/wallet" },
  { title: "Need a refund?", text: "Review our refund and disputes policy before asking support to look at a purchase.", href: "/refund-policy" },
  { title: "Contact support", text: "Send a message with your order ID, email, and the exact issue you are facing.", href: "/contact" },
];

const categories = [
  { title: "Getting started", description: "Learn the basics and browse common questions.", icon: Book, links: [
    { label: "How PryvaLogs works", href: "/how-it-works" },
    { label: "Frequently asked questions", href: "/faq" },
    { label: "Service status", href: "/status" },
  ] },
  { title: "Virtual numbers", description: "Learn about verification and protecting codes.", icon: MessageCircle, links: [
    { label: "Getting started with virtual numbers", href: "/blog/getting-started-virtual-numbers" },
    { label: "Account verification tips", href: "/blog/whatsapp-verification-tips" },
    { label: "Refund policy", href: "/refund-policy" },
  ] },
  { title: "eSIM and data", description: "Things to check before choosing a plan.", icon: Sparkle, links: [
    { label: "eSIM travel checklist", href: "/blog/esim-travel-guide" },
    { label: "Frequently asked questions", href: "/faq" },
    { label: "Service status", href: "/status" },
  ] },
  { title: "Account and billing", description: "Find your wallet, policy and support resources.", icon: Mail, links: [
    { label: "Wallet and transaction history", href: "/login?next=%2Fdashboard%2Fwallet" },
    { label: "Gift card guide", href: "/blog/gift-cards-for-teams" },
    { label: "Contact support", href: "/contact" },
  ] },
];

const faqs = [
  {
    question: "Why is my number or eSIM still pending?",
    answer: "Most orders are delivered automatically once the provider confirms the request. If it is still pending, first confirm the order status in your dashboard, then send the order ID and reference to support so the team can check the provider side.",
  },
  {
    question: "Why can I not withdraw to my bank account?",
    answer: "Withdrawals are only paid to an account matching the profile name recorded with the first completed top-up, unless a payout-name review has been approved by an operator. If the account uses a different spelling, ask support for a payout-name review with a bank statement or screenshot.",
  },
  {
    question: "What should I include in a support message?",
    answer: "Include the order reference, the email on your Pryva account, a clear description of the problem, and any screenshots or provider messages you received. It helps us resolve the case faster without extra back-and-forth.",
  },
  {
    question: "What is the difference between a refund and a reconciliation review?",
    answer: "A refund is for customer-initiated reversal when the order can be safely cancelled. A reconciliation review is used when the provider or delivery path is ambiguous and the operator must check the outcome before deciding the final status.",
  },
];

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-cream">
      <section className="py-16 sm:py-20">
        <div className="shell text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-lav-200 bg-lav-50 px-3 py-1 text-[0.8125rem] font-semibold uppercase tracking-[0.12em] text-lav-700">
            <Shield className="h-3.5 w-3.5" /> Support centre
          </div>
          <h1 className="text-[2.5rem] font-medium tracking-tight text-ink sm:text-[3rem]">How can we help you?</h1>
          <p className="mx-auto mt-4 max-w-2xl text-[1.125rem] text-ink-2">Find guides, policies, and fast help for your account, orders, wallet, payouts, and service issues.</p>
        </div>
      </section>

      <section className="pb-8">
        <div className="shell">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {quickActions.map((item) => (
              <Link key={item.title} href={item.href} className="rounded-2xl border border-line bg-white p-5 text-left transition-colors hover:border-lav-200 hover:bg-lav-50/30">
                <p className="text-[0.8125rem] font-semibold uppercase tracking-[0.12em] text-lav-700">Quick help</p>
                <h2 className="mt-3 text-[1rem] font-semibold text-ink">{item.title}</h2>
                <p className="mt-2 text-[0.875rem] leading-relaxed text-ink-2">{item.text}</p>
                <span className="mt-4 inline-flex items-center gap-2 text-[0.8125rem] font-medium text-lav-700">
                  Open <ArrowRight className="h-3.5 w-3.5" />
                </span>
              </Link>
            ))}
          </div>
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
                  <div>
                    <h2 className="text-[1.125rem] font-semibold text-ink">{category.title}</h2>
                    <p className="text-[0.875rem] text-ink-2">{category.description}</p>
                  </div>
                </div>
                <ul className="space-y-3">
                  {category.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className="flex items-center gap-2 text-[0.875rem] text-ink-2 hover:text-lav-600">
                        <ArrowRight className="h-3 w-3" />
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </section>

      <section className="pb-16">
        <div className="shell">
          <div className="rounded-2xl border border-line bg-white p-8">
            <div className="mb-6 text-center">
              <h2 className="text-[1.6rem] font-semibold text-ink">Common questions</h2>
              <p className="mt-2 text-[0.9375rem] text-ink-2">Answers to the problems customers ask about most often.</p>
            </div>
            <div className="grid gap-4">
              {faqs.map((item) => (
                <details key={item.question} className="group rounded-xl border border-line bg-cream px-4 py-3 open:border-lav-200 open:bg-white">
                  <summary className="cursor-pointer list-none text-left text-[0.9375rem] font-medium text-ink marker:hidden">
                    <span className="flex items-center justify-between gap-4">
                      {item.question}
                      <ArrowRight className="h-4 w-4 text-ink-3 transition-transform group-open:rotate-90" />
                    </span>
                  </summary>
                  <p className="mt-3 max-w-3xl text-[0.875rem] leading-relaxed text-ink-2">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="pb-16">
        <div className="shell">
          <div className="rounded-2xl border border-line bg-white p-8 text-center">
            <h2 className="mb-3 text-[1.5rem] font-semibold text-ink">Still need help?</h2>
            <p className="mx-auto mb-6 max-w-md text-[0.9375rem] text-ink-2">Contact support with your order or wallet reference and our team will review the case.</p>
            <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/contact" className="inline-flex items-center gap-2 rounded-xl bg-lav-700 px-6 py-3 text-[0.9375rem] font-semibold text-white hover:bg-lav-800">Contact support <ArrowRight className="h-4 w-4" /></Link>
              <Link href="/faq" className="inline-flex items-center gap-2 rounded-xl border border-line px-6 py-3 text-[0.9375rem] font-semibold text-ink hover:bg-cream">Browse FAQ</Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
