import { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { Star } from "@/components/icons";

export const metadata: Metadata = {
  title: "Testimonials",
  description: "What our customers are saying about Pryva.",
};

const testimonials = [
  {
    name: "Adaeze O.",
    role: "Digital Marketer",
    location: "Lagos, Nigeria",
    rating: 5,
    text: "Pryva has been a game-changer for my work. I can verify multiple social media accounts quickly without any issues. The virtual numbers work perfectly with WhatsApp and Instagram.",
  },
  {
    name: "Chinedu K.",
    role: "Software Developer",
    location: "Abuja, Nigeria",
    rating: 5,
    text: "As a developer, I need to test applications across different regions. Pryva's residential proxies and virtual numbers make this incredibly easy. The API is also well-documented.",
  },
  {
    name: "Fatima B.",
    role: "Travel Blogger",
    location: "Port Harcourt, Nigeria",
    rating: 5,
    text: "The eSIM service is fantastic! I traveled to 5 countries in Europe and had reliable data everywhere. No more searching for local SIM cards at every airport.",
  },
  {
    name: "Emeka N.",
    role: "E-commerce Entrepreneur",
    location: "Kano, Nigeria",
    rating: 5,
    text: "I use Pryva's bulk ordering for my business. The 10% discount on 20+ items saves me a lot of money. Customer support is also very responsive.",
  },
  {
    name: "Grace A.",
    role: "Freelancer",
    location: "Ibadan, Nigeria",
    rating: 5,
    text: "The automatic refund policy gives me peace of mind. I've only needed it once, and the refund was instant. Great service overall!",
  },
  {
    name: "Tunde M.",
    role: "Startup Founder",
    location: "Lagos, Nigeria",
    rating: 5,
    text: "We use Pryva gift cards to reward our team members. It's simple, fast, and they love having the flexibility to choose what they need.",
  },
];

const stats = [
  { label: "Happy Customers", value: "10,000+" },
  { label: "Average Rating", value: "4.9/5" },
  { label: "Services Delivered", value: "50,000+" },
  { label: "Countries Served", value: "40+" },
];

export default function TestimonialsPage() {
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
            Loved by thousands
          </h1>
          <p className="mt-4 text-[1.1rem] text-ink-2 max-w-2xl mx-auto">
            See what our customers are saying about their experience with Pryva.
          </p>
        </div>
      </section>

      {/* Stats */}
      <section className="pb-16">
        <div className="shell">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((stat) => (
              <div
                key={stat.label}
                className="rounded-2xl border border-line bg-white p-6 text-center"
              >
                <p className="text-[2.5rem] font-bold text-lav-600">{stat.value}</p>
                <p className="text-[0.9rem] text-ink-2 mt-2">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="pb-16">
        <div className="shell">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {testimonials.map((testimonial, index) => (
              <div
                key={index}
                className="rounded-2xl border border-line bg-white p-6"
              >
                <div className="flex gap-1 mb-4">
                  {[...Array(testimonial.rating)].map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                  ))}
                </div>
                <p className="text-[0.9rem] text-ink-2 mb-6 leading-relaxed">
                  "{testimonial.text}"
                </p>
                <div className="border-t border-line pt-4">
                  <p className="text-[0.95rem] font-semibold text-ink">
                    {testimonial.name}
                  </p>
                  <p className="text-[0.82rem] text-ink-3">
                    {testimonial.role} · {testimonial.location}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="pb-16">
        <div className="shell">
          <div className="rounded-2xl border border-line bg-white p-8 text-center">
            <h2 className="text-[1.75rem] font-semibold text-ink mb-3">
              Ready to join them?
            </h2>
            <p className="text-[0.95rem] text-ink-2 mb-6 max-w-md mx-auto">
              Start using Pryva today and see why thousands of Nigerians trust us for their digital service needs.
            </p>
            <Link
              href="/signup"
              className="inline-flex items-center gap-2 rounded-xl bg-lav-600 px-6 py-3 text-[0.95rem] font-semibold text-white hover:bg-lav-700"
            >
              Get Started Free
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
