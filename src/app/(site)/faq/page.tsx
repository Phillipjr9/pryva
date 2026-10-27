import { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
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
        a: "Pryva is a digital services platform that provides virtual phone numbers, eSIM data plans, residential proxies, email OTP services, and more. We make it easy for Nigerians to access global digital services with Naira payments.",
      },
      {
        q: "How do I create an account?",
        a: "Simply click the 'Get Started' button, enter your name and email, create a password, and verify your email. You can then top up your wallet and start using our services immediately.",
      },
      {
        q: "Is Pryva safe to use?",
        a: "Yes! We use industry-standard encryption, secure payment processing, and never store sensitive payment information. Your privacy and security are our top priorities.",
      },
    ],
  },
  {
    title: "Virtual Numbers",
    questions: [
      {
        q: "How quickly will I receive my virtual number?",
        a: "Virtual numbers are delivered instantly after payment. You'll see the number in your dashboard immediately and can start receiving SMS codes right away.",
      },
      {
        q: "Which platforms do your virtual numbers work with?",
        a: "Our non-VoIP numbers work with WhatsApp, Telegram, Google, Binance, PayPal, and 500+ other platforms. Check the specific platform's requirements if you're unsure.",
      },
      {
        q: "What's the difference between buying and renting a number?",
        a: "Buying gives you a number for a single verification (20-minute window), while renting keeps the number active for 7, 30, or 90 days for multiple verifications.",
      },
      {
        q: "What if my virtual number doesn't receive the code?",
        a: "If you don't receive the expected SMS code within the service window, you'll receive an automatic refund to your wallet. No questions asked.",
      },
    ],
  },
  {
    title: "eSIM & Data",
    questions: [
      {
        q: "How do I activate my eSIM?",
        a: "After purchasing an eSIM, you'll receive a QR code and activation instructions in your dashboard. Simply scan the QR code with your compatible device's camera.",
      },
      {
        q: "Which phones support eSIM?",
        a: "Most phones released from 2020 onward support eSIM, including iPhone XS and newer, Samsung Galaxy S20 and newer, Google Pixel 3 and newer, and many others.",
      },
      {
        q: "Can I keep my WhatsApp number when using an eSIM?",
        a: "Yes! Pryva eSIMs are data-only, so they run alongside your existing SIM. You can keep your WhatsApp and other apps on your primary line while using the eSIM for data.",
      },
    ],
  },
  {
    title: "Payments & Wallet",
    questions: [
      {
        q: "How do I top up my wallet?",
        a: "Go to your dashboard, click on 'Wallet', and choose your preferred payment method. We accept bank transfers, card payments, and other popular Nigerian payment methods.",
      },
      {
        q: "Are there any fees for wallet top-up?",
        a: "We don't charge any fees for wallet top-ups. You pay exactly the amount you want to add to your wallet.",
      },
      {
        q: "Can I withdraw money from my wallet?",
        a: "Currently, wallet balances can only be used for purchasing Pryva services. We're working on withdrawal functionality for the future.",
      },
      {
        q: "Do wallet balances expire?",
        a: "No, your wallet balance never expires. You can use it whenever you need to purchase services.",
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
      {/* Header */}
      <header className="border-b border-line bg-white">
        <div className="shell flex h-16 items-center justify-between">
          <Link href="/">
            <Logo />
          </Link>
          <div className="flex items-center gap-3">
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
              Can't find what you're looking for? Our support team is here to help.
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
