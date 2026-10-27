import { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Mail, MessageCircle, Book } from "@/components/icons";

export const metadata: Metadata = {
  title: "Help Center",
  description: "Get help with your Pryva account, orders, and services.",
};

const helpCategories = [
  {
    title: "Getting Started",
    description: "Learn the basics of using Pryva",
    icon: Book,
    articles: [
      "How to create an account",
      "How to top up your wallet",
      "Making your first purchase",
      "Understanding service types",
    ],
  },
  {
    title: "Virtual Numbers",
    description: "Everything about virtual number services",
    icon: MessageCircle,
    articles: [
      "How to buy a virtual number",
      "Receiving SMS verification codes",
      "Renting vs buying numbers",
      "Supported platforms and countries",
    ],
  },
  {
    title: "eSIM & Data",
    description: "eSIM activation and data plans",
    icon: Mail,
    articles: [
      "How to activate your eSIM",
      "Compatible devices",
      "Managing data usage",
      "Top-up and extensions",
    ],
  },
  {
    title: "Account & Billing",
    description: "Manage your account and payments",
    icon: Mail,
    articles: [
      "Wallet top-up methods",
      "Transaction history",
      "Refund policy",
      "Account security",
    ],
  },
];

const faqs = [
  {
    q: "How long does it take to receive a virtual number?",
    a: "Virtual numbers are delivered instantly after payment. You'll see the number and any received SMS codes in your dashboard immediately.",
  },
  {
    q: "Can I get a refund if my virtual number doesn't work?",
    a: "Yes! If your virtual number doesn't receive the expected SMS code within the service window, you'll receive an automatic refund to your wallet.",
  },
  {
    q: "Which countries do you support for virtual numbers?",
    a: "We support virtual numbers from 40+ countries including Nigeria, USA, UK, Canada, Germany, and many more. Check the pricing page for the full list.",
  },
  {
    q: "How do I activate my eSIM?",
    a: "After purchasing an eSIM, you'll receive a QR code and activation instructions in your dashboard. Simply scan the QR code with your compatible device.",
  },
  {
    q: "Can I use Pryva services for business purposes?",
    a: "Absolutely! Many of our customers use Pryva for business verification, testing, and operations. We offer bulk ordering discounts for high-volume purchases.",
  },
  {
    q: "Is my payment information secure?",
    a: "Yes. We use industry-standard encryption and never store your payment details. All transactions are processed through secure payment providers.",
  },
];

export default function HelpPage() {
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

      {/* Hero */}
      <section className="py-16 sm:py-20">
        <div className="shell text-center">
          <h1 className="text-[2.5rem] font-medium tracking-tight text-ink sm:text-[3rem]">
            How can we help you?
          </h1>
          <p className="mt-4 text-[1.1rem] text-ink-2 max-w-2xl mx-auto">
            Find answers to common questions, learn how to use Pryva, and get support when you need it.
          </p>
        </div>
      </section>

      {/* Help Categories */}
      <section className="pb-16">
        <div className="shell">
          <div className="grid gap-6 sm:grid-cols-2">
            {helpCategories.map((category) => {
              const Icon = category.icon;
              return (
                <div
                  key={category.title}
                  className="rounded-2xl border border-line bg-white p-6"
                >
                  <div className="flex items-start gap-4 mb-4">
                    <div className="grid h-12 w-12 place-items-center rounded-xl bg-lav-100 text-lav-600">
                      <Icon className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="text-[1.1rem] font-semibold text-ink">
                        {category.title}
                      </h3>
                      <p className="text-[0.86rem] text-ink-2">
                        {category.description}
                      </p>
                    </div>
                  </div>
                  <ul className="space-y-2">
                    {category.articles.map((article) => (
                      <li key={article}>
                        <a
                          href="#"
                          className="flex items-center gap-2 text-[0.86rem] text-ink-2 hover:text-lav-600"
                        >
                          <ArrowRight className="h-3 w-3" />
                          {article}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="pb-16">
        <div className="shell">
          <h2 className="text-[1.75rem] font-medium tracking-tight text-ink mb-8 text-center">
            Frequently Asked Questions
          </h2>
          <div className="max-w-3xl mx-auto space-y-4">
            {faqs.map((faq, index) => (
              <div
                key={index}
                className="rounded-2xl border border-line bg-white p-6"
              >
                <h3 className="text-[1rem] font-semibold text-ink mb-2">
                  {faq.q}
                </h3>
                <p className="text-[0.9rem] text-ink-2 leading-relaxed">
                  {faq.a}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact Support */}
      <section className="pb-16">
        <div className="shell">
          <div className="rounded-2xl border border-line bg-white p-8 text-center">
            <h2 className="text-[1.5rem] font-semibold text-ink mb-3">
              Still need help?
            </h2>
            <p className="text-[0.95rem] text-ink-2 mb-6 max-w-md mx-auto">
              Can&apos;t find what you&apos;re looking for? Our support team is here to help.
            </p>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 rounded-xl bg-lav-600 px-6 py-3 text-[0.95rem] font-semibold text-white hover:bg-lav-700"
            >
              Contact Support
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
