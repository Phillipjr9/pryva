import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Cookie Policy",
  description:
    "The cookies Pryva sets, what each one is for, and how to control them. We use no advertising or cross-site tracking cookies.",
  alternates: { canonical: "/cookie-policy" },
};

const cookies = [
  {
    name: "pryva_session",
    purpose: "Keeps you signed in. Without it you'd be logged out on every page.",
    type: "Essential",
    duration: "30 days",
  },
  {
    name: "pryva_theme",
    purpose: "Remembers whether you prefer light or dark mode.",
    type: "Preference",
    duration: "1 year",
  },
  {
    name: "pryva_csrf",
    purpose: "Protects forms and purchases from cross-site request forgery.",
    type: "Essential",
    duration: "Session",
  },
];

export default function CookiePolicyPage() {
  return (
    <main>
      <section className="border-b border-line/70 bg-gradient-to-b from-cream to-white">
        <div className="shell py-14 sm:py-16">
          <h1 className="text-[2.2rem] font-semibold tracking-tight text-ink sm:text-[2.6rem]">
            Cookie Policy
          </h1>
          <p className="mt-3 max-w-2xl text-[0.98rem] leading-relaxed text-ink-2">
            Short version: we use only what Pryva needs to work. No advertising cookies, no
            cross-site trackers, nothing sold to third parties.
          </p>
          <p className="mt-4 text-[0.82rem] text-ink-3">
            Last updated: {new Date().toLocaleDateString("en-NG", { year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
      </section>

      <section className="shell py-10">
        <div className="overflow-hidden rounded-2xl border border-line bg-white">
          <table className="w-full text-left">
            <thead className="bg-cream/70 text-[0.72rem] uppercase tracking-[0.12em] text-ink-3">
              <tr>
                <th className="px-4 py-3 font-semibold">Cookie</th>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 font-semibold">Duration</th>
                <th className="hidden px-4 py-3 font-semibold md:table-cell">Why</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {cookies.map((cookie) => (
                <tr key={cookie.name} className="align-top">
                  <td className="px-4 py-4 font-mono text-[0.8rem] text-ink">{cookie.name}</td>
                  <td className="px-4 py-4">
                    <span className="inline-flex rounded-full bg-lav-50 px-2.5 py-1 text-[0.7rem] font-semibold text-lav-700">
                      {cookie.type}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-[0.84rem] text-ink-2">{cookie.duration}</td>
                  <td className="hidden px-4 py-4 text-[0.84rem] leading-relaxed text-ink-2 md:table-cell">
                    {cookie.purpose}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-8 space-y-6">
          <div className="rounded-2xl border border-line bg-white p-5">
            <h2 className="text-[1rem] font-semibold text-ink">Payments</h2>
            <p className="mt-2 max-w-3xl text-[0.88rem] leading-relaxed text-ink-2">
              Wallet top-ups open a checkout page hosted by our payment processor. That page sets its own
              cookies to prevent fraud, under their privacy policy and only while you are on it. Pryva
              never sees or stores your card details.
            </p>
          </div>

          <div className="rounded-2xl border border-line bg-white p-5">
            <h2 className="text-[1rem] font-semibold text-ink">Managing cookies</h2>
            <p className="mt-2 max-w-3xl text-[0.88rem] leading-relaxed text-ink-2">
              You can clear or block cookies in your browser settings. Blocking the essential ones will
              sign you out and break checkout, because the session cookie is what ties a purchase to your
              wallet. Everything else on the site keeps working.
            </p>
          </div>

          <div className="rounded-2xl border border-line bg-white p-5">
            <h2 className="text-[1rem] font-semibold text-ink">Questions</h2>
            <p className="mt-2 text-[0.88rem] leading-relaxed text-ink-2">
              Ask us anything about data handling via{" "}
              <Link href="/contact" className="font-semibold text-lav-700 underline underline-offset-2">
                support
              </Link>
              , or read the{" "}
              <Link href="/privacy" className="font-semibold text-lav-700 underline underline-offset-2">
                Privacy Policy
              </Link>{" "}
              for the full picture.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
