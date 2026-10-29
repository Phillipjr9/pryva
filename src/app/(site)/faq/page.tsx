import { Metadata } from "next";
import Link from "next/link";
import { Accordion, AccordionItem } from "@/components/ui/Accordion";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Frequently asked questions about Pryva services.",
};

const faqCategories = [
  {
    title: "General",
    questions: [
      {
        q: "What is Pryva?",
        a: "Pryva is a Naira wallet and digital-services application. Virtual numbers for SMS verification are delivered automatically; categories we cannot yet deliver reliably are marked unavailable rather than sold.",
      },
      {
        q: "How do I create an account?",
        a: "Choose Get Started and enter your name, email and password. Password signup does not currently verify email ownership, so use a unique password you do not reuse elsewhere.",
      },
      {
        q: "Is Pryva safe to use?",
        a: "Use a unique password and keep your verification codes and gift-card codes private. Passwords are stored as hashes. Contact support if you notice activity you do not recognize.",
      },
    ],
  },
  {
    title: "Virtual Numbers",
    questions: [
      {
        q: "How quickly will I receive my virtual number?",
        a: "A number is provisioned immediately after payment. The code itself arrives when the platform sends it, and your order page keeps checking until the delivery window closes.",
      },
      {
        q: "Which platforms do your virtual numbers work with?",
        a: "Compatibility is not guaranteed. Check the destination platform's rules and restrictions before relying on a virtual number.",
      },
      {
        q: "What's the difference between buying and renting a number?",
        a: "A single-verification number receives one code within a short delivery window. A rental keeps the same number for 30 or 90 days, and you can re-read incoming codes while it is active.",
      },
      {
        q: "What if my virtual number doesn't receive the code?",
        a: "Contact support with your order reference. Live order refunds require a review of delivery and provider status.",
      },
    ],
  },
  {
    title: "eSIM & Data",
    questions: [
      {
        q: "How do I activate my eSIM?",
        a: "eSIM plans are not available for purchase yet. They are listed for reference and marked unavailable, so you cannot be charged for one.",
      },
      {
        q: "Which phones support eSIM?",
        a: "Compatibility varies by model, region and carrier. Check your device and carrier documentation for eSIM support and unlock requirements.",
      },
      {
        q: "Can I keep my WhatsApp number when using an eSIM?",
        a: "Your existing account can generally remain associated with its original number, but check your device, carrier and app settings. eSIM plans are not available for purchase yet.",
      },
    ],
  },
  {
    title: "Payments & Wallet",
    questions: [
      {
        q: "How do I top up my wallet?",
        a: "Open Wallet, choose an amount and follow the Paystack checkout instructions. Paystack shows the payment methods available to you at checkout, and your wallet is credited only once the payment is confirmed.",
      },
      {
        q: "Are there any fees for wallet top-up?",
        a: "Review the amount and any fees shown by the payment provider before confirming.",
      },
      {
        q: "Can I withdraw money from my wallet?",
        a: "Withdrawal requests require administrator review and a payment provider that can settle them. A request or transfer initiation is not proof of settlement.",
      },
      {
        q: "Do wallet balances expire?",
        a: "Your current balance and transaction history are shown in Wallet. Balances do not expire, and every top-up and purchase is listed with its own reference.",
      },
    ],
  },
  {
    title: "Gift Cards",
    questions: [
      {
        q: "How do gift cards work?",
        a: "You purchase a gift card with a specific amount, receive a unique code, and share it with the recipient. They enter the code in their Pryva account to redeem the credit.",
      },
      {
        q: "Can I cancel or refund a gift card?",
        a: "No, gift cards are non-refundable once purchased. Please ensure the amount and recipient details are correct before confirming.",
      },
      {
        q: "How long are gift cards valid?",
        a: "Gift cards are valid for 12 months from the date of purchase.",
      },
    ],
  },
];

export default function FAQPage() {
  return (
    <div className="min-h-screen bg-cream">
      {/* Hero */}
      <section className="py-16">
        <div className="shell text-center">
          <h1 className="text-[2.5rem] font-medium tracking-tight text-ink sm:text-[3rem]">
            Frequently Asked Questions
          </h1>
          <p className="mt-4 text-[1.1rem] text-ink-2 max-w-2xl mx-auto">
            Find answers to common questions about Pryva and our services.
          </p>
        </div>
      </section>

      {/* FAQ Content */}
      <section className="pb-16">
        <div className="shell max-w-3xl">
          <div className="space-y-8">
            {faqCategories.map((category) => (
              <div key={category.title}>
                <h2 className="text-[1.5rem] font-semibold text-ink mb-4">
                  {category.title}
                </h2>
                <Accordion>
                  {category.questions.map((faq, index) => (
                    <AccordionItem key={index} title={faq.q}>
                      {faq.a}
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact CTA */}
      <section className="pb-16">
        <div className="shell">
          <div className="max-w-2xl mx-auto rounded-2xl border border-line bg-white p-8 text-center">
            <h2 className="text-[1.5rem] font-semibold text-ink mb-3">
              Still have questions?
            </h2>
            <p className="text-[0.95rem] text-ink-2 mb-6">
              Can&apos;t find what you&apos;re looking for? Our support team is here to help.
            </p>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 rounded-xl bg-lav-600 px-6 py-3 text-[0.95rem] font-semibold text-white hover:bg-lav-700"
            >
              Contact Support
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
