import { Metadata } from "next";
import Link from "next/link";
import { serviceMap } from "@/lib/catalog";
import { ServiceIcon } from "@/components/ServiceIcon";

export const metadata: Metadata = {
  title: "Free Temporary Email",
  description:
    "A free temporary inbox: one at a time, for signed-in accounts. Nothing here is bought, ordered or charged.",
};

/**
 * This page used to sell four inbox tiers. It does not sell anything now, and
 * the change is deliberate rather than a retreat:
 *
 *   • The tiers could never be delivered. The provider's email products expose
 *     no duration, so "24 hours" and "30 days" were the same purchase upstream.
 *   • They could never have sold either. A disposable inbox is a commodity with
 *     an effective market price of zero; free services hand one out in a click.
 *
 * So the inbox became a free tool attached to an account instead of a product.
 * That has one consequence this page has to respect: there is no price to show,
 * no plan to compare, and nothing to route a visitor to `/signup?plan=...` for.
 * The previous version rendered priced cards with working "Get Started" buttons
 * under copy that said nothing could be ordered — a contradiction a visitor
 * could act on. Every call to action here now points somewhere that is true.
 *
 * When the inbox tool itself switches on, this page is where its UI goes. Until
 * then it says plainly that it is not live yet, which is the same standard the
 * eSIM and proxy pages are held to.
 */
export default function EmailOTPPage() {
  const service = serviceMap["email-otp"];

  if (!service) return <div>Service not found</div>;

  return (
    <div className="min-h-screen bg-cream">
      <section className="py-16 sm:py-20">
        <div className="shell">
          <div className="max-w-3xl">
            <ServiceIcon service="email-otp" size="lg" className="mb-5" />
            <span className="inline-block rounded-full bg-lav-100 px-4 py-1.5 text-[0.78rem] font-semibold text-lav-700 mb-4">
              {service.eyebrow}
            </span>
            <h1 className="text-[2.5rem] font-medium tracking-tight text-ink sm:text-[3.5rem]">
              {service.tagline}
            </h1>
            <p className="mt-6 text-[1.1rem] text-ink-2 leading-relaxed">{service.description}</p>
          </div>
        </div>
      </section>

      {/* Free, and what that means */}
      <section className="pb-12">
        <div className="shell">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 sm:p-8">
            <p className="text-[0.72rem] uppercase tracking-[0.14em] font-semibold text-emerald-800">
              No price, no plan, no charge
            </p>
            <h2 className="mt-3 text-[1.5rem] font-semibold text-emerald-950">
              A temporary inbox is free
            </h2>
            <p className="mt-3 text-[0.95rem] leading-relaxed text-emerald-900 max-w-2xl">
              Disposable email is not something we sell. You will never see an inbox price here,
              in pricing, or at checkout, because there is nothing to buy. Everything we do charge
              for — verification numbers, rentals, eSIM, proxies, accounts — keeps its own price,
              and this being free does not change any of it.
            </p>
            <ul className="mt-5 space-y-2 text-[0.9rem] text-emerald-900">
              <li>One active inbox at a time, per account.</li>
              <li>Read what arrives, then discard the inbox whenever you want.</li>
              <li>No wallet debit and no order reference — a free tool creates neither.</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Where the tool actually is.
          This used to be an amber notice saying the inbox was not switched on,
          which was the honest thing to render while nothing existed to switch
          on. It exists now, so the honest thing is a link to it — and the
          dashboard page is where unavailability can be reported dynamically if
          the source is ever not configured, rather than being baked into copy
          that cannot notice. */}
      <section className="pb-12">
        <div className="shell">
          <div className="rounded-2xl border border-lav-200 bg-lav-50 p-6 sm:p-8">
            <h2 className="text-[1.25rem] font-semibold text-ink">
              Create your inbox from the dashboard
            </h2>
            <p className="mt-3 text-[0.95rem] leading-relaxed text-ink-2 max-w-2xl">
              One free inbox per day for a signed-in account, alive until you discard it. Nothing is
              kept afterwards, so read your code while the inbox is open — retaining messages is what
              the paid inbox is for.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link href="/dashboard/inbox" className="btn btn-primary !px-5 !py-2.5 !text-[0.85rem]">
                Open your inbox
              </Link>
              <Link
                href="/status"
                className="btn border border-line bg-white !px-5 !py-2.5 !text-[0.85rem] text-ink"
              >
                Service status
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="pb-16">
        <div className="shell">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {service.highlights.map((highlight, index) => (
              <div key={index} className="rounded-2xl border border-line bg-white p-6">
                <h3 className="text-[1.1rem] font-semibold text-ink mb-3">{highlight.title}</h3>
                <p className="text-[0.9rem] text-ink-2 leading-relaxed">{highlight.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The warning that actually protects people */}
      <section className="pb-16">
        <div className="shell max-w-3xl">
          <div className="rounded-2xl border border-line bg-white p-6">
            <h2 className="text-[1.15rem] font-semibold text-ink mb-3">
              Read this before using any temporary address
            </h2>
            <p className="text-[0.9rem] text-ink-2 leading-relaxed">
              A temporary inbox is for a code you need once. It is not a mailbox you will get back:
              when it is discarded, or when it expires, anything sent to that address is gone and
              there is no way to recover it. Do not use one for a bank, a primary email account, or
              any service you might need to reset a password on later — a password reset sent to a
              dead address locks you out for good. Some platforms also refuse temporary addresses
              outright, so check their terms before you rely on one.
            </p>
          </div>
        </div>
      </section>

      <section className="pb-20">
        <div className="shell max-w-3xl">
          <h2 className="text-[1.75rem] font-semibold text-ink mb-8">FAQ</h2>
          <div className="space-y-4">
            {service.faqs.map((faq, index) => (
              <div key={index} className="rounded-2xl border border-line bg-white p-6">
                <h3 className="text-[1rem] font-semibold text-ink mb-3">{faq.q}</h3>
                <p className="text-[0.9rem] text-ink-2 leading-relaxed">{faq.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
