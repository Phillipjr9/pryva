import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Pryva Terms of Service - Read our terms and conditions.",
};

export default function TermsPage() {
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
            Terms of Service
          </h1>

          <div className="prose prose-lg max-w-none">
            <h2>1. Acceptance of Terms</h2>
            <p>
              By accessing and using Pryva&apos;s services, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use our services.
            </p>

            <h2>2. Description of Services</h2>
            <p>
              Pryva provides digital services including but not limited to virtual phone numbers, eSIM data plans, residential proxies, email OTP services, data plans, bulk ordering, and scheduled purchases. Pryva also issues gift cards, which carry wallet credit rather than being a separate service.
            </p>

            <h2>3. User Accounts</h2>
            <p>
              You must create an account to use our services. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account.
            </p>

            <h2>4. Wallet and Payments</h2>
            <p>
              Pryva operates on a wallet-based system. You must top up your wallet before making purchases. All payments are processed in Nigerian Naira (NGN). We accept various payment methods including bank transfers and card payments.
            </p>

            <h2>5. Refund Policy</h2>
            <p>
              Live order refunds require a review of delivery and provider status. Contact support with your order reference. Gift cards are non-refundable once purchased. See the refund policy for details.
            </p>

            <h2>6. Prohibited Uses</h2>
            <p>
              You agree not to use our services for any illegal activities, spam, fraud, or any purpose that violates applicable laws or regulations.
            </p>

            <h2>7. Service Availability</h2>
            <p>
              Service availability is not guaranteed. Products that cannot currently be delivered are marked unavailable and cannot be ordered or charged. See the service status page for current availability.
            </p>

            <h2>8. Limitation of Liability</h2>
            <p>
              Pryva&apos;s liability is limited to the amount paid for the specific service in question. We are not liable for any indirect, incidental, or consequential damages.
            </p>

            <h2>9. Privacy</h2>
            <p>
              Your use of our services is also governed by our Privacy Policy. Please review our Privacy Policy to understand our practices.
            </p>

            <h2>10. Changes to Terms</h2>
            <p>
              These terms may change. Review the current version before using the service.
            </p>

            <h2>11. Contact Information</h2>
            <p>
              If you have questions about these Terms of Service, please contact us at support@pryva.ng or through our contact page.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
