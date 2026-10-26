import { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Pryva Privacy Policy - Learn how we protect your data.",
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-cream dark:bg-gray-900">
      {/* Header */}
      <header className="border-b border-line bg-white dark:bg-gray-800 dark:border-gray-700">
        <div className="shell flex h-16 items-center justify-between">
          <Link href="/">
            <Logo />
          </Link>
          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-[0.86rem] font-medium text-ink-2 hover:text-ink dark:text-gray-400 dark:hover:text-gray-100"
            >
              Sign in
            </Link>
            <Link
              href="/signup"
              className="rounded-xl bg-lav-600 px-4 py-2 text-[0.86rem] font-semibold text-white hover:bg-lav-700 dark:bg-lav-500 dark:hover:bg-lav-600"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      {/* Content */}
      <section className="py-16">
        <div className="shell max-w-3xl">
          <h1 className="text-[2.5rem] font-medium tracking-tight text-ink mb-8 dark:text-gray-100">
            Privacy Policy
          </h1>
          <p className="text-[0.9rem] text-ink-2 mb-8 dark:text-gray-400">
            Last updated: {new Date().toLocaleDateString("en-NG", { year: "numeric", month: "long", day: "numeric" })}
          </p>

          <div className="prose prose-lg max-w-none dark:prose-invert">
            <h2>1. Information We Collect</h2>
            <p>
              We collect information you provide directly to us, including your name, email address, phone number, and payment information when you create an account or make a purchase.
            </p>

            <h2>2. How We Use Your Information</h2>
            <p>
              We use the information we collect to provide, maintain, and improve our services, process transactions, send you technical notices and support messages, and respond to your comments and questions.
            </p>

            <h2>3. Information Sharing</h2>
            <p>
              We do not sell, trade, or rent your personal information to third parties. We may share your information with service providers who assist us in operating our platform, subject to confidentiality agreements.
            </p>

            <h2>4. Data Security</h2>
            <p>
              We implement industry-standard security measures to protect your personal information, including encryption, secure servers, and regular security audits. However, no method of transmission over the internet is 100% secure.
            </p>

            <h2>5. Data Retention</h2>
            <p>
              We retain your personal information for as long as your account is active or as needed to provide you services. We may retain certain information as required by law or for legitimate business purposes.
            </p>

            <h2>6. Cookies and Tracking</h2>
            <p>
              We use cookies and similar tracking technologies to track activity on our platform and hold certain information. You can control cookies through your browser settings.
            </p>

            <h2>7. Your Rights</h2>
            <p>
              You have the right to access, update, or delete your personal information at any time through your account settings. You may also request a copy of your data or ask us to delete your account.
            </p>

            <h2>8. Children's Privacy</h2>
            <p>
              Our services are not intended for children under 18. We do not knowingly collect personal information from children under 18.
            </p>

            <h2>9. Changes to Privacy Policy</h2>
            <p>
              We may update this privacy policy from time to time. We will notify you of any changes by posting the new privacy policy on this page and updating the "Last updated" date.
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
