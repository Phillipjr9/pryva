import { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The agreement between you and Pryva: your account, your wallet, how orders are delivered and refunded, what is not allowed, and how disputes are handled.",
  alternates: { canonical: "/terms" },
};

/**
 * Written to match what the product actually does today.
 *
 * The previous version was eleven generic paragraphs that predated gift cards,
 * two-factor sign-in, purchase-verified reviews, account lockout and the
 * withdrawal flow, and it lived in `prose` classes that this Tailwind build does
 * not load — so the page rendered as unstyled body text. This one is sectioned,
 * anchored, and states the limitations the product enforces in code: a product
 * that is switched off cannot be ordered or charged, a number cannot promise a
 * code from a platform, and a gift card is not refundable.
 *
 * It does not invent facts. There is no company registration number, registered
 * address or incorporation date here because none has been confirmed for this
 * site; legal notices point at the contact page, which is the channel the app
 * actually monitors.
 */

type Clause = {
  id: string;
  title: string;
  body: ReactNode;
};

const LAST_UPDATED = "30 October 2026";

const clauses: Clause[] = [
  {
    id: "agreement",
    title: "1. This agreement",
    body: (
      <>
        <p>
          These terms are the agreement between you and Pryva (&ldquo;Pryva&rdquo;, &ldquo;we&rdquo;,
          &ldquo;us&rdquo;) for the use of this website and everything sold through it. By creating an
          account, topping up a wallet or placing an order, you accept them. If you do not accept
          them, do not use the service.
        </p>
        <p>
          They sit alongside the <Link href="/refund-policy">refund policy</Link>,{" "}
          <Link href="/privacy">privacy policy</Link> and{" "}
          <Link href="/cookie-policy">cookie policy</Link>, which are part of this agreement. Where
          two of these documents disagree, the refund policy decides questions about refunds and
          these terms decide everything else.
        </p>
      </>
    ),
  },
  {
    id: "eligibility",
    title: "2. Who can open an account",
    body: (
      <>
        <p>
          You must be at least 18 and able to enter a binding contract. You must give a name and an
          email address that are yours. Temporary or disposable inboxes are refused at sign-up,
          because they are deleted by design and would take your verification link, receipts and
          password resets with them.
        </p>
        <p>
          One account per person. Accounts are personal: do not share a password, and do not open a
          second account to get around a suspension or a limit.
        </p>
      </>
    ),
  },
  {
    id: "account",
    title: "3. Your account and its security",
    body: (
      <>
        <p>
          You are responsible for everything done with your account. Keep your password private,
          and turn on two-factor authentication in{" "}
          <Link href="/dashboard/security">security settings</Link> if your account handles money —
          it is checked after the password and before any session is created.
        </p>
        <p>
          We protect the sign-in path in ways you may notice:
        </p>
        <ul>
          <li>
            repeated wrong passwords lock the account for 30 minutes after 8 consecutive failures,
            so online guessing cannot grind a password;
          </li>
          <li>
            signing in is rate limited per connection and per address, and a correct password on an
            account with two-factor enabled yields a challenge, not a session;
          </li>
          <li>
            completing a password reset signs out every existing session and releases a lock.
          </li>
        </ul>
        <p>
          Tell us at once through the <Link href="/contact">contact page</Link> if you think someone
          else has your password. We may suspend an account while we investigate, and we will say
          why.
        </p>
      </>
    ),
  },
  {
    id: "wallet",
    title: "4. Your wallet",
    body: (
      <>
        <p>
          Pryva runs on a prepaid wallet in Nigerian Naira. You top up through our payment provider
          by bank transfer or card, and orders are paid from the balance. Wallet credit is a record
          of what you have paid us for future orders. It is not a bank deposit, it earns no
          interest, and it is not a stored-value instrument you can transfer to someone else —
          except through a gift card, which is ours to issue and which carries credit.
        </p>
        <p>
          A top-up is credited once the payment is confirmed to us, never on the strength of a
          pending page or a screenshot. Unused credit can be withdrawn to a Nigerian bank account in
          your own name; withdrawals are settled by an operator, and we may ask for identification
          that matches the account name. We may refuse or reverse a credit that we later establish
          was not paid, was paid twice, or was the subject of a chargeback.
        </p>
      </>
    ),
  },
  {
    id: "products",
    title: "5. Products, prices and availability",
    body: (
      <>
        <p>
          The catalogue lists what Pryva can currently sell: virtual numbers for receiving SMS
          verification codes, number rentals, eSIM data, residential proxies, temporary inboxes,
          digital accounts, streaming subscriptions, data and airtime, bulk and scheduled orders,
          and gift cards. Prices are shown in Naira and include our margin; they may change at any
          time, and the price shown at checkout is the price that applies.
        </p>
        <p>
          Some products are listed but switched off while we cannot deliver them reliably. Those
          products cannot be ordered and cannot be charged — the checkout refuses rather than
          taking money for something it cannot fulfil. The{" "}
          <Link href="/status">status page</Link> says which products are orderable today, and it
          is generated from the same switch the checkout uses.
        </p>
      </>
    ),
  },
  {
    id: "delivery",
    title: "6. Delivery, and what we cannot promise",
    body: (
      <>
        <p>
          Orders are delivered to your dashboard as soon as the product is available, usually
          seconds after payment. You are buying our effort and the access we can obtain, not a
          guaranteed outcome on a third-party platform.
        </p>
        <ul>
          <li>
            <strong>Virtual numbers</strong> are for receiving verification codes. Whether a
            particular platform accepts a number, and whether it sends a code at all, is decided by
            that platform and can change without notice. Check a platform&rsquo;s rules before
            relying on a number.
          </li>
          <li>
            <strong>Rentals</strong> keep the same number for the period shown on the plan. Codes
            that arrive while the rental is active stay readable; the number may be reassigned
            afterwards.
          </li>
          <li>
            <strong>Digital accounts</strong> are delivered as the access the order describes.
            Change the password and recovery details immediately, and follow the platform&rsquo;s
            rules: an account can be restricted by the platform for reasons outside our control.
          </li>
          <li>
            <strong>eSIM data</strong> needs a compatible, carrier-unlocked device. Coverage and
            speed belong to the network that serves you.
          </li>
        </ul>
        <p>
          Where a purchase is completed by hand rather than automatically, we do not take payment
          until the work is confirmed.
        </p>
      </>
    ),
  },
  {
    id: "refunds",
    title: "7. Refunds, disputes and chargebacks",
    body: (
      <>
        <p>
          Refunds are decided against the delivery outcome, and the{" "}
          <Link href="/refund-policy">refund policy</Link> sets out the rule for each product. In
          short: if the product was not delivered, contact support with the order reference and we
          will review it against what the delivery side reports. Automatic refunds stay paused until
          delivery and cancellation can be verified from both ends, because paying a refund on an
          unknown outcome loses the money twice.
        </p>
        <p>
          Gift cards are not refundable whether or not they have been redeemed. That is enforced in
          the code, not only in this paragraph.
        </p>
        <p>
          If you believe a charge is wrong, contact us first. Raising a chargeback instead of
          asking suspends the account while the bank investigates, and we may recover the disputed
          amount, plus any fee the processor charges, from the wallet balance.
        </p>
      </>
    ),
  },
  {
    id: "acceptable-use",
    title: "8. What you may not do",
    body: (
      <>
        <p>Using Pryva for any of the following is a breach of these terms:</p>
        <ul>
          <li>fraud, deception, impersonation, or taking over an account that is not yours;</li>
          <li>
            creating accounts on third-party platforms to evade a ban, to bulk-register, or in
            breach of that platform&rsquo;s rules;
          </li>
          <li>spam, unsolicited bulk messaging, or harassment;</li>
          <li>any unlawful purpose, or anything that breaks Nigerian law or the law where you are;</li>
          <li>
            attacking the service: probing for vulnerabilities, bypassing rate limits, scraping
            other customers&rsquo; data, or interfering with the payment and delivery systems;
          </li>
          <li>
            reselling, sub-licensing or white-labelling anything bought here without our written
            permission.
          </li>
        </ul>
        <p>
          We may suspend or close an account that does any of this, and we may report conduct to
          the authorities where the law requires it.
        </p>
      </>
    ),
  },
  {
    id: "reviews",
    title: "9. Reviews and other content you post",
    body: (
      <>
        <p>
          A review can only be written by the account that bought the order, and only after it was
          delivered or completed. Reviews are moderated before they appear: we publish what
          customers write, including criticism, and we do not edit the substance of a review or
          invent one to fill a page.
        </p>
        <p>
          By posting a review you give us permission to show it, with the product name and the
          first name on your account, on this site. Do not post personal data about other people.
        </p>
      </>
    ),
  },
  {
    id: "suspension",
    title: "10. Suspension and closing your account",
    body: (
      <>
        <p>
          You may close your account at any time from{" "}
          <Link href="/dashboard/settings">settings</Link>. We may suspend or close an account that
          breaches these terms, that we are legally required to close, or that is the subject of a
          payment dispute.
        </p>
        <p>
          When an account closes, orders already delivered stay delivered. Any wallet credit that is
          not owed to us — for a chargeback, a reversed payment or an order in progress — is
          returned to a bank account in your name, or, if you ask, paid out before closure. Gift
          cards already issued stay redeemable only by the account they were issued to.
        </p>
      </>
    ),
  },
  {
    id: "availability",
    title: "11. Availability of the service",
    body: (
      <>
        <p>
          We work to keep the site up, and we publish planned and current status on the{" "}
          <Link href="/status">status page</Link>. We do not promise uninterrupted service: parts of
          it depend on payment processors, networks and other providers, and a product can become
          unavailable without notice.
        </p>
        <p>
          If a failure on our side leaves an order undelivered, the refund policy applies. If a
          failure on our side leaves a wallet balance wrong, tell us and we will correct it against
          the transaction record.
        </p>
      </>
    ),
  },
  {
    id: "liability",
    title: "12. Liability",
    body: (
      <>
        <p>
          Nothing in these terms limits liability that cannot be limited by law, including for
          fraud or for death or personal injury caused by negligence.
        </p>
        <p>
          Otherwise, our liability for a product is limited to the amount you paid for that product,
          and we are not liable for indirect or consequential losses — including lost profit, lost
          data, or an account on a third-party platform being restricted — except where those losses
          were a foreseeable result of our breach.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    title: "13. Changes to these terms",
    body: (
      <>
        <p>
          We will change these terms when the product changes. The date below is the version in
          force. A change that affects money, refunds or your rights is announced on the site before
          it takes effect, and continuing to use the service after that date means you accept the
          new version.
        </p>
        <p>
          Each version is dated, so a dispute can be settled against the terms that applied when the
          order was placed rather than the ones that happen to be live today.
        </p>
      </>
    ),
  },
  {
    id: "law",
    title: "14. Governing law and disputes",
    body: (
      <>
        <p>
          These terms are governed by the laws of the Federal Republic of Nigeria. If something goes
          wrong, contact us first through the <Link href="/contact">contact page</Link> with the
          order reference: most disputes are about a delivery that did or did not happen, and we can
          usually settle that from the transaction record.
        </p>
        <p>
          If we cannot settle it between us, the courts of Lagos State have jurisdiction, without
          affecting any right you have to bring a claim where you live.
        </p>
      </>
    ),
  },
  {
    id: "contact",
    title: "15. Notices and contact",
    body: (
      <>
        <p>
          Notices to us go through the <Link href="/contact">contact page</Link>. Notices to you go
          to the email address on your account — which is one more reason a temporary inbox is
          refused — and are treated as received when sent.
        </p>
        <p>
          Questions about these terms, or about a specific order, are answered by support. We aim to
          reply within one working day.
        </p>
      </>
    ),
  },
];

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-cream">
      <header className="border-b border-line bg-white">
        <div className="shell flex h-16 items-center justify-between">
          <Link href="/" className="text-[0.95rem] font-semibold tracking-tight text-ink">
            Pryva
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-[0.86rem] font-medium text-ink-2 hover:text-ink">
              Sign in
            </Link>
            <Link
              href="/signup"
              className="rounded-xl bg-lav-600 px-4 py-2 text-[0.86rem] font-semibold text-white hover:bg-lav-700"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      <section className="py-12 sm:py-16">
        <div className="shell max-w-5xl">
          <p className="eyebrow">Legal</p>
          <h1 className="mt-3 text-[2rem] font-medium tracking-tight text-ink sm:text-[2.5rem]">
            Terms of Service
          </h1>
          <p className="mt-3 max-w-2xl text-[0.95rem] leading-relaxed text-ink-2">
            The agreement between you and Pryva. It is written to match what the product does today,
            including the parts that are deliberately switched off.
          </p>
          <p className="mt-2 text-[0.8rem] text-ink-3">
            Version in force from <time dateTime="2026-10-30">{LAST_UPDATED}</time>
          </p>

          <div className="mt-8 grid gap-10 lg:grid-cols-[16rem_1fr] lg:items-start">
            <nav aria-label="Contents" className="lg:sticky lg:top-24">
              <p className="text-meta font-semibold uppercase tracking-wide text-ink-3">On this page</p>
              <ol className="mt-3 space-y-1.5 text-[0.85rem]">
                {clauses.map((clause) => (
                  <li key={clause.id}>
                    <a href={`#${clause.id}`} className="text-ink-2 transition hover:text-ink">
                      {clause.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>

            <div className="space-y-10">
              <aside className="rounded-2xl border border-line bg-white p-5">
                <p className="text-meta font-semibold uppercase tracking-wide text-ink-3">
                  In plain words
                </p>
                <ul className="mt-3 space-y-2 text-[0.9rem] leading-relaxed text-ink-2">
                  <li>Your wallet holds Naira you have already paid, and orders come out of it.</li>
                  <li>
                    You buy our effort, not a guarantee: a platform can refuse a number or restrict
                    an account.
                  </li>
                  <li>
                    Refunds are reviewed against what actually happened to the order, and gift cards
                    are never refundable.
                  </li>
                  <li>
                    Fraud, ban evasion and attacks on the service cost you the account.
                  </li>
                  <li>
                    Questions go through the contact page, not a chargeback.
                  </li>
                </ul>
              </aside>

              {clauses.map((clause) => (
                <section key={clause.id} id={clause.id} className="scroll-mt-24">
                  <h2 className="text-[1.15rem] font-medium tracking-tight text-ink">
                    {clause.title}
                  </h2>
                  <div className="mt-3 space-y-3 text-[0.92rem] leading-relaxed text-ink-2 [&_a]:font-medium [&_a]:text-lav-700 [&_a]:underline [&_a]:underline-offset-2 [&_li]:pl-1 [&_strong]:font-semibold [&_strong]:text-ink [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
                    {clause.body}
                  </div>
                </section>
              ))}

              <section className="rounded-2xl border border-line bg-white p-5">
                <h2 className="text-[1rem] font-medium text-ink">Earlier versions</h2>
                <ul className="mt-2 space-y-1 text-[0.85rem] text-ink-2">
                  <li>
                    <time dateTime="2026-10-30">{LAST_UPDATED}</time> — rewritten to cover gift
                    cards, two-factor sign-in, account lockout, purchase-verified reviews,
                    withdrawals and the products that are switched off.
                  </li>
                  <li>Before that — an eleven-clause summary that predated all of the above.</li>
                </ul>
              </section>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
