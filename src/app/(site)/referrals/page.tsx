import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Gift, Shield, Users, Wallet } from "@/components/icons";
import { DEFAULT_REWARD_CAP_NGN, DEFAULT_REWARD_PERCENT } from "@/lib/content/referrals";
import { formatNaira } from "@/lib/services/catalog";

export const metadata: Metadata = {
  title: "Referral program — earn wallet credit",
  description: `Invite friends to PryvaLogs and earn ${DEFAULT_REWARD_PERCENT}% of their first order, up to ${formatNaira(DEFAULT_REWARD_CAP_NGN)}, paid straight into your wallet.`,
  alternates: { canonical: "/referrals" },
  openGraph: {
    title: "Earn wallet credit by referring friends | PryvaLogs",
    description: `Share your invite link. When a friend's first order is delivered, you earn ${DEFAULT_REWARD_PERCENT}% back — up to ${formatNaira(DEFAULT_REWARD_CAP_NGN)}.`,
    url: "/referrals",
  },
};

const steps = [
  {
    n: "01",
    icon: Gift,
    title: "Get your invite link",
    body: "Open the Referrals page in your dashboard. Your unique link is ready the moment you visit — no application needed.",
  },
  {
    n: "02",
    icon: Users,
    title: "Share it anywhere",
    body: "Send the link by message, email or social media. Anyone who signs up through it is counted as your referral.",
  },
  {
    n: "03",
    icon: Check,
    title: "They place their first order",
    body: "Once your friend's first order is delivered, the reward is calculated automatically. A pending or refunded order does not qualify.",
  },
  {
    n: "04",
    icon: Wallet,
    title: "Credit lands in your wallet",
    body: `You earn ${DEFAULT_REWARD_PERCENT}% of their first order's value, up to ${formatNaira(DEFAULT_REWARD_CAP_NGN)} per person. Spend it on any service.`,
  },
];

const faqs = [
  {
    q: "How much do I earn per referral?",
    a: `${DEFAULT_REWARD_PERCENT}% of your friend's first delivered order, up to a maximum of ${formatNaira(DEFAULT_REWARD_CAP_NGN)} per person.`,
  },
  {
    q: "When does the reward arrive?",
    a: "Automatically, after their first qualifying order is confirmed as delivered. You will see it in your wallet activity.",
  },
  {
    q: "Can I refer myself?",
    a: "No. Self-referrals are blocked at the database level and do not earn a reward.",
  },
  {
    q: "What counts as a qualifying order?",
    a: "Any delivered order — numbers, eSIM, accounts, gift cards or any other service. A pending or refunded order does not count.",
  },
  {
    q: "Can I withdraw the reward as cash?",
    a: "No. Referral rewards are wallet credit. You can spend them on any PryvaLogs service, but they cannot be withdrawn to a bank account.",
  },
  {
    q: "Is there a limit to how many friends I can invite?",
    a: "No. You can invite as many people as you like. Each friend earns you one reward after their first delivered order.",
  },
];

export default function ReferralsPage() {
  return (
    <div className="min-h-screen bg-cream">
      <section className="py-16 sm:py-24">
        <div className="shell">
          <div className="mx-auto max-w-3xl text-center">
            <span className="eyebrow justify-center">Referral program</span>
            <h1 className="mt-4 text-[2.5rem] font-medium leading-[1.06] tracking-tight text-ink sm:text-[3.5rem]">
              Invite friends.{" "}
              <span className="text-display italic text-lav-700">Earn wallet credit.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-[1rem] leading-relaxed text-ink-2">
              Share your unique invite link. When a friend joins and their first order is delivered,{" "}
              <strong className="text-ink">{DEFAULT_REWARD_PERCENT}%</strong> of that order lands in
              your wallet — up to{" "}
              <strong className="text-ink">{formatNaira(DEFAULT_REWARD_CAP_NGN)}</strong> per person.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link
                href="/login?next=%2Fdashboard%2Freferrals"
                className="btn btn-primary w-full sm:w-auto !px-7 !py-3.5"
              >
                Get your invite link
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/signup" className="btn btn-ghost w-full sm:w-auto !px-7 !py-3.5">
                Create an account first
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="pb-16">
        <div className="shell">
          <div className="mx-auto max-w-3xl overflow-hidden rounded-[2rem] border border-lav-200 bg-gradient-to-br from-lav-100 via-[#f7f1ff] to-cream px-6 py-10 sm:px-10">
            <div className="grid gap-6 text-center sm:grid-cols-3">
              {[
                { label: "Reward rate", value: `${DEFAULT_REWARD_PERCENT}%` },
                { label: "Maximum per friend", value: formatNaira(DEFAULT_REWARD_CAP_NGN) },
                { label: "Friends you can invite", value: "Unlimited" },
              ].map((stat) => (
                <div key={stat.label}>
                  <p className="text-[2rem] font-semibold tracking-tight text-lav-700">{stat.value}</p>
                  <p className="mt-1 text-[0.875rem] text-ink-2">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="pb-16 sm:pb-24">
        <div className="shell">
          <div className="mx-auto max-w-2xl text-center">
            <span className="eyebrow justify-center">How it works</span>
            <h2 className="mt-4 text-[2rem] font-medium leading-[1.08] sm:text-[2.5rem]">
              Four steps.{" "}
              <span className="text-display italic text-lav-700">One link.</span>
            </h2>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, index) => {
              const Icon = step.icon;
              return (
                <div key={step.n} className="relative rounded-2xl border border-line bg-white p-5">
                  <span className="text-display text-[2.4rem] leading-none text-lav-300">{step.n}</span>
                  <div className="mt-3 flex items-center gap-2">
                    <Icon className="h-4 w-4 text-lav-600" />
                    <h3 className="text-[1rem] font-semibold">{step.title}</h3>
                  </div>
                  <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-2">{step.body}</p>
                  {index < steps.length - 1 && (
                    <span className="absolute -right-2.5 top-1/2 hidden h-5 w-5 -translate-y-1/2 place-items-center rounded-full bg-white text-lav-500 shadow-sm lg:grid">
                      <ArrowRight className="h-3 w-3" />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="pb-16">
        <div className="shell">
          <div className="mx-auto max-w-3xl rounded-2xl border border-line bg-white p-6 sm:p-8">
            <h2 className="flex items-center gap-2 text-[1.25rem] font-semibold text-ink">
              <Shield className="h-5 w-5 text-lav-600" /> Program rules
            </h2>
            <ul className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                "One reward per invited person — not per order they place.",
                "The reward is paid only after a qualifying delivered order.",
                "Pending, refunded or failed orders do not qualify.",
                "Self-referrals are blocked and earn nothing.",
                "Inviting someone from the same network is flagged for review.",
                "Rewards are wallet credit — they cannot be withdrawn as cash.",
                "The reward rate and cap can change with a deployment update.",
                "PryvaLogs may void rewards that appear to abuse the program.",
              ].map((rule) => (
                <li key={rule} className="flex items-start gap-2 text-[0.875rem] text-ink-2">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lav-600" />
                  {rule}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="pb-16">
        <div className="shell max-w-3xl">
          <h2 className="text-[1.75rem] font-semibold text-ink">Frequently asked questions</h2>
          <div className="mt-6 space-y-4">
            {faqs.map((faq) => (
              <div key={faq.q} className="rounded-2xl border border-line bg-white p-6">
                <h3 className="text-[1rem] font-semibold text-ink">{faq.q}</h3>
                <p className="mt-2 text-[0.875rem] leading-relaxed text-ink-2">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="pb-16">
        <div className="shell">
          <div className="mx-auto max-w-2xl rounded-[2rem] bg-ink px-6 py-12 text-center text-white sm:px-10">
            <h2 className="text-[1.8rem] font-medium leading-[1.08] sm:text-[2.2rem]">
              Ready to start earning?
            </h2>
            <p className="mx-auto mt-3 max-w-md text-[0.9375rem] leading-relaxed text-white/70">
              Sign in to get your invite link. It takes less than a minute.
            </p>
            <Link
              href="/login?next=%2Fdashboard%2Freferrals"
              className="btn mt-7 inline-flex bg-white !px-7 !py-3.5 text-ink hover:bg-lav-50"
            >
              Get your invite link
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
