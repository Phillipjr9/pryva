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
        a: "Pryva is a wallet and digital-services application. Live fulfillment for numbers, eSIMs, proxies, email, data, bulk and scheduled orders is currently paused. Preview balances and orders are simulated.",
      },
      {
        q: "How do I create an account?",
        a: "Choose Get Started and enter your name, email and password. Password signup does not currently verify email ownership. Use a unique password; available payment and purchase features depend on the environment.",
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
        a: "Live virtual-number fulfillment is currently paused. Preview orders are simulated and do not receive real SMS messages.",
      },
      {
        q: "Which platforms do your virtual numbers work with?",
        a: "Compatibility is not guaranteed. Check the destination platform's rules and restrictions before relying on a virtual number; live fulfillment is currently paused.",
      },
      {
        q: "What's the difference between buying and renting a number?",
        a: "The catalog distinguishes single-verification and rental plans, but live fulfillment for both is paused. Preview orders do not issue working numbers.",
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
        a: "Live eSIM fulfillment is currently paused. Preview activation details are simulated and will not activate a real plan.",
      },
      {
        q: "Which phones support eSIM?",
        a: "Compatibility varies by model, region and carrier. Check your device and carrier documentation for eSIM support and unlock requirements.",
      },
      {
        q: "Can I keep my WhatsApp number when using an eSIM?",
        a: "Your existing account can generally remain associated with its original number, but check your device, carrier and app settings. Live eSIM fulfillment is paused.",
      },
    ],
  },
  {
    title: "Payments & Wallet",
    questions: [
      {
        q: "How do I top up my wallet?",
        a: "In a configured live environment, open Wallet and follow the Paystack checkout instructions. Available payment methods depend on the provider. Top-ups are disabled in preview mode.",
      },
      {
        q: "Are there any fees for wallet top-up?",
        a: "Review the amount and any fees shown by the payment provider before confirming.",
      },
      {
        q: "Can I withdraw money from my wallet?",
        a: "Withdrawal requests require a configured live payment provider and administrator review. A request or transfer initiation is not proof of settlement. Bank transfers are disabled in preview.",
      },
      {
        q: "Do wallet balances expire?",
        a: "Your current balance and transaction history are shown in Wallet. Preview balances are simulated and are lost when the preview is reset.",
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
