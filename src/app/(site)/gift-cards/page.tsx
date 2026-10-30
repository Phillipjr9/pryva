import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Card, Shield } from "@/components/icons";
import { formatNaira } from "@/lib/catalog";
import { ServiceIcon } from "@/components/ServiceIcon";
import {
  GIFT_CARD_MAX_AMOUNT,
  GIFT_CARD_MIN_AMOUNT,
  GIFT_CARD_VALIDITY_MONTHS,
} from "@/lib/gift-card-rules";

/**
 * The explainer page for gift cards.
 *
 * Everything on this page is a statement about code that exists: the amount
 * range and expiry come from `createGiftCard`, the one-redemption and
 * cannot-redeem-your-own rules come from `redeemGiftCard`, and the
 * non-refundability comes from `refundGiftCard`. `src/test/gift-card-page.test.tsx`
 * reads those functions and fails if this copy stops matching them, because a
 * marketing page that quietly contradicts the checkout is how customers end up
 * filing chargebacks.
 */

export const metadata: Metadata = {
  title: "Gift cards",
  description:
    "Buy a Pryva gift card from your wallet balance, from ₦1,000 to ₦500,000, and let someone redeem it into their wallet. One year validity, one redemption.",
  alternates: { canonical: "/gift-cards" },
  openGraph: {
    title: "Pryva gift cards",
    description:
      "Wallet credit as a gift: buy from your balance, share the code, and the recipient redeems it into their Pryva wallet.",
    url: "/gift-cards",
    type: "website",
  },
};

const MIN = formatNaira(GIFT_CARD_MIN_AMOUNT);
const MAX = formatNaira(GIFT_CARD_MAX_AMOUNT);

const facts: Array<{ term: string; detail: string }> = [
  {
    term: "Amount",
    detail: `Any whole-naira amount from ${MIN} to ${MAX}. It is paid from your Pryva wallet, not from a card or a bank transfer.`,
  },
  {
    term: "Validity",
    detail: `${GIFT_CARD_VALIDITY_MONTHS} months from purchase. After that the code stops working — unused value is not refunded or extended.`,
  },
  {
    term: "Redemption",
    detail: "One redemption, for the whole amount. There is no partial spend and no balance left on the card afterwards.",
  },
  {
    term: "Who can redeem",
    detail: "Any signed-in Pryva account except the one that bought it. The recipient needs an account before the credit can land.",
  },
  {
    term: "Refunds",
    detail: "Gift cards are not refundable, including the unused ones. Treat the purchase as final before you confirm it.",
  },
  {
    term: "Delivery",
    detail: "We show you the code once and keep it in your gift-card history. We do not email it to the recipient — you send it yourself.",
  },
];

const steps = [
  {
    title: "Buy from your balance",
    body: `Choose an amount between ${MIN} and ${MAX}. The wallet debit and the card are created in the same transaction, so a failed purchase cannot leave you charged without a code.`,
  },
  {
    title: "Share the code",
    body: "The code looks like PRYVA-XXXX-XXXX-XXXX. Copy it, or note the recipient's email on the card for your own records. We store that address; we do not send anything to it.",
  },
  {
    title: "They redeem it",
    body: "Signed in, the recipient enters the code under Gift cards. The full amount lands in their wallet immediately and the code stops working for anyone else.",
  },
];

const faqs = [
  {
    q: "Can I redeem my own gift card?",
    a: "No. The code is rejected on the account that bought it, so buying a card for yourself never credits your own wallet. Send it to the person you had in mind.",
  },
  {
    q: "What happens if the code is lost?",
    a: "It stays in your gift-card history on the dashboard, so a lost message is not a lost card. Anyone who has the code can redeem it, so do not post it publicly.",
  },
  {
    q: "Can the recipient split it across two accounts?",
    a: "No. Redemption is all-or-nothing: the whole amount goes to the first account that redeems it, and the card is then spent.",
  },
  {
    q: "Can I get a refund if it is never used?",
    a: "No. Gift cards are non-refundable, which is also why the amount is debited once, at purchase, and never charged again.",
  },
  {
    q: "What does the recipient need?",
    a: "A Pryva account and the code. Signing in is required, because the credit has to land in a wallet we can identify.",
  },
  {
    q: "Is there a limit on attempts?",
    a: "Check and redemption attempts are rate-limited per account and per network. A wrong code costs an attempt, so guessing is not a realistic way to find one.",
  },
];

export default function GiftCardsPage() {
  return (
    <main>
      <section className="border-b border-line/70 bg-gradient-to-b from-cream to-white">
        <div className="shell py-14 sm:py-20">
          <div className="max-w-3xl">
            <ServiceIcon service="gift-cards" size="lg" className="mb-5" />
            <span className="inline-flex items-center gap-2 rounded-full border border-lav-200 bg-white px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-lav-800">
              <Card className="h-3.5 w-3.5" />
              Gift cards
            </span>
            <h1 className="mt-5 text-[2.1rem] font-semibold leading-[1.1] tracking-tight text-ink sm:text-[2.9rem]">
              Wallet credit, wrapped as a gift.
            </h1>
            <p className="mt-4 max-w-2xl text-[1rem] leading-relaxed text-ink-2">
              A Pryva gift card is a code worth a fixed amount of wallet credit. You buy it from
              your own balance, send the code to someone, and they redeem it into their wallet.
              Pryva issues the card itself, so the code exists the moment you pay for it.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/login?next=%2Fdashboard%2Fgift-cards" className="btn btn-primary">
                Sign in to buy a gift card
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/pricing" className="btn btn-ghost">
                See what the wallet can buy
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="shell py-14">
        <div className="grid gap-4 md:grid-cols-3">
          {steps.map((step, index) => (
            <article key={step.title} className="rounded-3xl border border-line bg-white p-6">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-lav-100 text-[0.8rem] font-semibold text-lav-800">
                {index + 1}
              </span>
              <h2 className="mt-4 text-[1.05rem] font-semibold text-ink">{step.title}</h2>
              <p className="mt-2 text-[0.9rem] leading-relaxed text-ink-2">{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="border-y border-line/70 bg-cream-2/40">
        <div className="shell py-14">
          <span className="eyebrow">The rules, in full</span>
          <h2 className="mt-3 max-w-2xl text-[1.6rem] font-medium leading-[1.15] tracking-[-0.02em] sm:text-[2rem]">
            Short list, and none of it is hidden in the checkout.
          </h2>
          <dl className="mt-8 grid gap-4 sm:grid-cols-2">
            {facts.map((fact) => (
              <div key={fact.term} className="rounded-2xl border border-line bg-white/80 p-5">
                <dt className="text-[0.82rem] font-semibold uppercase tracking-[0.12em] text-lav-800">
                  {fact.term}
                </dt>
                <dd className="mt-2 text-[0.9rem] leading-relaxed text-ink-2">{fact.detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="shell grid gap-6 py-14 md:grid-cols-2">
        <div className="rounded-3xl border border-line bg-white p-6">
          <Shield className="h-5 w-5 text-lav-700" />
          <h2 className="mt-3 text-[1.1rem] font-semibold">Treat the code like cash</h2>
          <p className="mt-2 text-[0.92rem] leading-relaxed text-ink-2">
            Whoever redeems it first keeps the value, and we cannot reverse a redemption once it has
            happened. Send it in a message to one person rather than posting it in a group, and do
            not paste it into a support chat — nobody at Pryva needs it to help you, because your
            history shows the card already.
          </p>
        </div>
        <div className="rounded-3xl border border-line bg-white p-6">
          <h3 className="text-[1.1rem] font-semibold">What it is not</h3>
          <ul className="mt-3 space-y-2 text-[0.92rem] leading-relaxed text-ink-2">
            {[
              "Not a discount: the full amount is paid from your wallet.",
              "Not reloadable: buy a new card instead of topping one up.",
              "Not a bank card or a withdrawal method — it is wallet credit.",
              "Not a way to move money to yourself: your own card is refused.",
            ].map((line) => (
              <li key={line} className="flex gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-lav-700" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="shell pb-16">
        <h2 className="text-[1.5rem] font-medium tracking-[-0.02em] sm:text-[1.8rem]">
          Questions people actually ask
        </h2>
        <div className="mt-6 divide-y divide-line rounded-3xl border border-line bg-white">
          {faqs.map((faq) => (
            <details key={faq.q} className="group px-5 py-4">
              <summary className="cursor-pointer list-none text-[0.95rem] font-semibold text-ink">
                {faq.q}
              </summary>
              <p className="mt-2 text-[0.9rem] leading-relaxed text-ink-2">{faq.a}</p>
            </details>
          ))}
        </div>
        <div className="mt-8 rounded-3xl border border-lav-200 bg-lav-50/60 p-6 sm:flex sm:items-center sm:justify-between">
          <div>
            <h3 className="text-[1.05rem] font-semibold">Ready when the balance is</h3>
            <p className="mt-1 text-[0.9rem] leading-relaxed text-ink-2">
              Gift cards are bought from your Pryva wallet. Top up first if the balance is short.
            </p>
          </div>
          <Link href="/login?next=%2Fdashboard%2Fwallet" className="btn btn-primary mt-4 sm:mt-0">
            Open the wallet
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </main>
  );
}
