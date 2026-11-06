import type { Metadata } from "next";
import Link from "next/link";
import { ContactForm } from "@/components/site/ContactForm";
import { getCurrentUser } from "@/lib/identity/auth";
import { Clock, Mail, MessageCircle, Shield } from "@/components/icons";

export const metadata: Metadata = {
  title: "Get in touch",
  description:
    "Share feature ideas, service requests and feedback with PryvaLogs. Tell us what you want built or what service you want more of.",
  alternates: { canonical: "/contact" },
};

/**
 * Public contact page.
 *
 * This used to be a second, client-side copy of the support form with its own
 * topic vocabulary ("general", "billing"…) while the dashboard form saved human
 * labels ("Wallet or refund"). Both wrote to the same table, so the support
 * inbox showed two inconsistent sets of topics. It now renders the shared form.
 */
export default async function ContactPage() {
  const user = await getCurrentUser().catch(() => null);

  return (
    <div className="min-h-screen bg-cream">
      <section className="py-16">
        <div className="shell text-center">
          <h1 className="text-[2.5rem] font-medium tracking-tight text-ink sm:text-[3rem]">
            Get in touch
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-[1.1rem] text-ink-2">
            Tell us what you want to see next, what service you would like more of, or what we can improve.
            We want your advice.
          </p>
        </div>
      </section>

      <section className="pb-16">
        <div className="shell">
          <div className="mb-12 grid gap-6 sm:grid-cols-3">
            <div className="rounded-2xl border border-line bg-white p-6 text-center">
              <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-lav-100 text-lav-600">
                <Mail className="h-6 w-6" />
              </div>
              <h2 className="mb-2 text-[1rem] font-semibold text-ink">Share an idea</h2>
              <p className="text-[0.86rem] text-ink-2">
                <a href="#contact-form" className="text-lav-700 underline underline-offset-2">
                  Send us feedback or a service request
                </a>
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-white p-6 text-center">
              <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-green-100 text-green-600">
                <MessageCircle className="h-6 w-6" />
              </div>
              <h2 className="mb-2 text-[1rem] font-semibold text-ink">Tell us more</h2>
              <p className="text-[0.86rem] text-ink-2">
                Add your idea, request, or improvement below
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-white p-6 text-center">
              <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-blue-100 text-blue-600">
                <Clock className="h-6 w-6" />
              </div>
              <h2 className="mb-2 text-[1rem] font-semibold text-ink">Response time</h2>
              <p className="text-[0.86rem] text-ink-2">May vary · we reply to the email you give</p>
            </div>
          </div>

          <div id="contact-form" className="mx-auto max-w-2xl scroll-mt-6">
            <ContactForm
              signedIn={Boolean(user)}
              defaultName={user?.name ?? ""}
              defaultEmail={user?.email ?? ""}
            />

            <div className="mt-6 grid gap-3 rounded-2xl border border-line bg-white p-4 text-[0.75rem] text-ink-2 sm:grid-cols-2 sm:p-5">
              <p className="flex items-start gap-2 leading-relaxed">
                <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lav-600" />
                Never send passwords, card details, bank logins or verification codes.
              </p>
              <p className="flex items-start gap-2 leading-relaxed">
                <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lav-600" />
                Looking for an answer first? Try the{" "}
                <Link href="/faq" className="font-semibold text-lav-700 underline underline-offset-2">
                  FAQ
                </Link>{" "}
                or the{" "}
                <Link href="/help" className="font-semibold text-lav-700 underline underline-offset-2">
                  help centre
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
