import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Cookie Policy",
  description:
    "Learn about the cookies and browser storage used by Pryva.",
  alternates: { canonical: "/cookie-policy" },
};

const cookies = [
  { name: "pryva_session", purpose: "Keeps you signed in.", type: "Essential", duration: "Up to 30 days" },
  { name: "pryva_session_3p", purpose: "Session fallback for embedded previews when used.", type: "Essential", duration: "Up to 30 days" },
  { name: "pryva_google_state", purpose: "Protects the Google sign-in flow.", type: "Essential", duration: "10 minutes" },
  { name: "pryva_google_next", purpose: "Remembers where to return after Google sign-in.", type: "Essential", duration: "10 minutes" },
];

export default function CookiePolicyPage() {
  return (
    <div>
      <section className="border-b border-line/70 bg-gradient-to-b from-cream to-white">
        <div className="shell py-14 sm:py-16">
          <h1 className="text-[2.2rem] font-semibold tracking-tight text-ink sm:text-[2.6rem]">
            Cookie Policy
          </h1>
          <p className="mt-3 max-w-2xl text-[0.98rem] leading-relaxed text-ink-2">
            Pryva uses session and sign-in cookies. Third-party services may use their own cookies under their policies.
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
              Configured live wallet top-ups open a Paystack checkout. Paystack and other third-party services may use their own cookies; consult their policies for details.
            </p>
          </div>

          <div className="rounded-2xl border border-line bg-white p-5">
            <h2 className="text-[1rem] font-semibold text-ink">Managing cookies</h2>
            <p className="mt-2 max-w-3xl text-[0.88rem] leading-relaxed text-ink-2">
              You can clear or block cookies in your browser settings. Blocking session cookies can prevent sign-in and authenticated features. Browser local storage holds the “pryva-theme” preference and, during an unresolved withdrawal request, a user-scoped request ID, amount and internal bank-account ID to support safe retries. It does not store bank details there. Clearing this recovery record does not cancel a withdrawal; check your requests or contact support before submitting another.
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
    </div>
  );
}
