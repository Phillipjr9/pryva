import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Account Provenance & Transfer Policy",
  description:
    "How PryvaLogs requires suppliers to establish account provenance, original-holder authorization, and authority to transfer accounts offered in the marketplace.",
  alternates: { canonical: "/account-provenance" },
  openGraph: {
    title: "Account Provenance & Transfer Policy | PryvaLogs",
    description:
      "The provenance, authorization, platform-transfer, and enforcement requirements for accounts offered by PryvaLogs.",
    url: "/account-provenance",
    type: "article",
  },
};

const LAST_UPDATED = "11 November 2026";

const sections = [
  {
    id: "scope",
    title: "1. Accounts covered by this policy",
    body: (
      <>
        <p>
          This policy applies to every digital account currently offered through the{" "}
          <Link href="/accounts">PryvaLogs account marketplace</Link>, including aged, social-media,
          email, gaming, streaming, and other accounts supplied through an inventory feed. It applies
          to the live catalogue, not only to accounts added after its publication date.
        </p>
        <p>
          Inventory that is still undergoing a required provenance review, or that fails a requirement
          in this policy, must not remain available for purchase. It must be rejected or suspended until
          the issue is resolved.
        </p>
      </>
    ),
  },
  {
    id: "authority",
    title: "2. Source, consent, and authority to transfer",
    body: (
      <>
        <p>Before account inventory is offered, the supplier must establish:</p>
        <ul>
          <li>the origin of the inventory and how the supplier obtained it;</li>
          <li>
            whether the supplier is the original account holder or has documented authorization from
            the original holder or an authorized agent;
          </li>
          <li>explicit permission for the account to be transferred or resold; and</li>
          <li>that the proposed transfer is permitted by the applicable platform&apos;s rules.</li>
        </ul>
        <p>
          We reject or suspend inventory when adequate authority cannot be established. A buyer&apos;s
          acceptance of risk is not a substitute for supplier authority or original-holder consent.
        </p>
      </>
    ),
  },
  {
    id: "review",
    title: "3. Review records and limitations",
    body: (
      <>
        <p>
          Inventory must be associated with a provenance record, supplier declaration, or audit
          reference that identifies its source and asserted authority to transfer. We may review these
          records without requesting a working account, password, customer identity, or payment record.
        </p>
        <p>
          A supplier declaration is not independent proof of consent. Where the available evidence does
          not substantiate the declaration, or the supplier cannot clarify a discrepancy, the affected
          inventory fails the review and must be removed or suspended.
        </p>
      </>
    ),
  },
  {
    id: "prohibited",
    title: "4. Prohibited sources",
    body: (
      <>
        <p>We do not knowingly accept accounts obtained through:</p>
        <ul>
          <li>phishing, malware, credential stuffing, social engineering, or unauthorized access;</li>
          <li>the sale or disclosure of credentials without the original holder&apos;s authorization;</li>
          <li>circumvention of a platform&apos;s access controls or transfer restrictions; or</li>
          <li>a source the supplier refuses to identify or cannot reasonably substantiate.</li>
        </ul>
      </>
    ),
  },
  {
    id: "platform-rules",
    title: "5. Platform rules and account delivery",
    body: (
      <>
        <p>
          Original-holder consent does not override a platform&apos;s rules. Where a platform prohibits
          the proposed transfer, the account must not be offered as an authorized transfer. Buyers must
          also follow the applicable platform&apos;s terms after delivery.
        </p>
        <p>
          Delivery describes the access supplied with an order; it is not a guarantee that a third-party
          platform will keep an account available or endorse the transfer. Platform enforcement can occur
          for reasons outside PryvaLogs&apos; control. Our{" "}
          <Link href="/refund-policy">refund policy</Link> explains how delivery issues are reviewed.
        </p>
      </>
    ),
  },
  {
    id: "reports",
    title: "6. Questions and provenance reports",
    body: (
      <>
        <p>
          We may suspend affected inventory while investigating a provenance concern. To ask about this
          policy or report an account you believe was listed without authority, use our{" "}
          <Link href="/contact">contact page</Link>. Do not send passwords, active credentials, private
          customer information, or payment records. An order or listing reference is sufficient for an
          initial review.
        </p>
        <p>
          We may update this policy as review requirements or platform rules change. The version date
          above identifies the currently published policy.
        </p>
      </>
    ),
  },
];

export default function AccountProvenancePage() {
  return (
    <main>
      <section className="border-b border-line/70 bg-gradient-to-b from-cream to-white">
        <div className="shell py-14 sm:py-16">
          <span className="eyebrow">Marketplace standards</span>
          <h1 className="mt-4 max-w-3xl text-[2rem] font-semibold tracking-tight text-ink sm:text-[2.7rem]">
            Account Provenance &amp; Transfer Policy
          </h1>
          <p className="mt-4 max-w-2xl text-[0.9375rem] leading-relaxed text-ink-2 sm:text-[1rem]">
            The source, original-holder authorization, platform-transfer, and enforcement requirements
            for every account offered in the PryvaLogs marketplace.
          </p>
          <p className="mt-4 text-meta text-ink-3">Version in force from {LAST_UPDATED}</p>
        </div>
      </section>

      <div className="shell grid gap-10 py-10 lg:grid-cols-[15rem_minmax(0,1fr)] lg:py-14">
        <aside className="h-fit rounded-2xl border border-line bg-white p-5 lg:sticky lg:top-24">
          <h2 className="text-[0.875rem] font-semibold text-ink">On this page</h2>
          <nav aria-label="Policy sections" className="mt-3">
            <ol className="space-y-2.5">
              {sections.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`} className="text-[0.8125rem] leading-relaxed text-ink-2 hover:text-lav-700">
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        <div className="min-w-0 space-y-5">
          {sections.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-24 rounded-2xl border border-line bg-white p-6 sm:p-7">
              <h2 className="text-[1.125rem] font-semibold tracking-tight text-ink">{section.title}</h2>
              <div className="mt-4 space-y-3 text-[0.9375rem] leading-relaxed text-ink-2 [&_a]:font-medium [&_a]:text-lav-700 [&_a]:underline [&_a]:underline-offset-2 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
                {section.body}
              </div>
            </section>
          ))}
          <p className="text-[0.8125rem] leading-relaxed text-ink-3">
            Related documents: <Link href="/terms">Terms of Service</Link>,{" "}
            <Link href="/refund-policy">Refund Policy</Link>, and <Link href="/privacy">Privacy Policy</Link>.
          </p>
        </div>
      </div>
    </main>
  );
}
