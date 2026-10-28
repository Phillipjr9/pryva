import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Pryva Privacy Policy - Learn how we protect your data.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-cream">
      {/* Header */}
      <header className="border-b border-line bg-white">
        <div className="shell flex h-16 items-center justify-between">
          <div className="ml-auto flex items-center gap-3">
            <Link
              href="/login"
              className="text-[0.86rem] font-medium text-ink-2 hover:text-ink"
            >
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

      {/* Content */}
      <section className="py-16">
        <div className="shell max-w-3xl">
          <h1 className="text-[2.5rem] font-medium tracking-tight text-ink mb-8">
            Privacy Policy
          </h1>

          <div className="prose prose-lg max-w-none">
            <h2>1. Information We Collect</h2>
            <p>
              The application stores account details such as name, email and password hash, along with order, wallet and support records. Bank details may be collected when you add a withdrawal account. Payment providers may collect additional information during checkout.
            </p>

            <h2>2. How We Use Your Information</h2>
            <p>
              We use the information we collect to provide, maintain, and improve our services, process transactions, send you technical notices and support messages, and respond to your comments and questions.
            </p>

            <h2>3. Information Sharing</h2>
            <p>
              Service providers such as payment and identity providers may receive information needed to process their services. Review their policies as well as this page.
            </p>

            <h2>4. Data Security</h2>
            <p>
              Passwords are stored as hashes and sessions use HTTP-only cookies. No method of storage or transmission is completely secure; contact support if you suspect unauthorized activity.
            </p>

            <h2>5. Data Retention</h2>
            <p>
              We retain your personal information for as long as your account is active or as needed to provide you services. We may retain certain information as required by law or for legitimate business purposes.
            </p>

            <h2>6. Cookies and Tracking</h2>
            <p>
              Session and sign-in cookies support authentication. Browser local storage may hold a theme preference and an unresolved withdrawal request ID, amount and internal account ID for retry recovery. You can control these through your browser settings, but clearing recovery data does not cancel a withdrawal.
            </p>

            <h2>7. Your Rights</h2>
            <p>
              Contact support to request access, correction or deletion. Self-service account deletion is currently unavailable while financial-record retention and settlement are reviewed.
            </p>

            <h2>8. Children&apos;s Privacy</h2>
            <p>
              Our services are not intended for children under 18. We do not knowingly collect personal information from children under 18.
            </p>

            <h2>9. Changes to Privacy Policy</h2>
            <p>
              This page may be updated as the application and data-handling practices change.
            </p>

            <h2>10. Contact Us</h2>
            <p>
              If you have questions about this Privacy Policy, please contact us at privacy@pryva.ng or through our contact page.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
