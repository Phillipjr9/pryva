import Link from "next/link";
import { Logo, Monogram } from "@/components/brand/Logo";
import { ArrowRight, Card, Shield, Check } from "@/components/icons";
import { services } from "@/lib/catalog";

const columns = [
  {
    title: "Services",
    links: services.map((service) => ({ href: service.href, label: service.name })),
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About Pryva" },
      { href: "/how-it-works", label: "How it works" },
      { href: "/pricing", label: "Pricing" },
      { href: "/faq", label: "FAQ" },
    ],
  },
  {
    title: "Support",
    links: [
      { href: "/contact", label: "Contact support" },
      { href: "/contact#refunds", label: "Refund policy" },
      { href: "/login", label: "Sign in" },
      { href: "/signup", label: "Create account" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="relative mt-24 overflow-hidden border-t border-line/70 bg-cream-2/60">
      <div className="pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-lav-200/40 blur-3xl" />
      <div className="pointer-events-none absolute -right-20 bottom-0 h-80 w-80 rounded-full bg-peach/60 blur-3xl" />

      <div className="shell relative">
        <div className="relative overflow-hidden rounded-[2rem] border border-lav-200/80 bg-gradient-to-br from-lav-100 via-[#f7f1ff] to-cream px-6 py-10 sm:px-10 sm:py-12">
          <Monogram className="pointer-events-none absolute -right-8 -top-10 h-64 w-64 opacity-[0.08]" />
          <div className="relative flex flex-col gap-7 md:flex-row md:items-end md:justify-between">
            <div className="max-w-xl">
              <span className="eyebrow">Start in a couple of minutes</span>
              <h2 className="mt-3 text-3xl font-medium leading-[1.08] sm:text-[2.6rem]">
                A calmer way to verify,
                <br />
                <span className="text-display italic text-lav-700">connect and scale.</span>
              </h2>
              <p className="mt-3 max-w-md text-[0.94rem] leading-relaxed text-ink-2">
                Create a free Pryva account, fund your wallet in Naira, and get your first number,
                eSIM or inbox delivered instantly.
              </p>
            </div>
            <div className="flex flex-col gap-2.5 sm:flex-row md:flex-col">
              <Link href="/signup" className="btn btn-primary">
                Create free account
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/pricing" className="btn btn-ghost">
                View pricing
              </Link>
            </div>
          </div>
        </div>

        <div className="mt-14 grid gap-10 pb-12 md:grid-cols-[1.3fr_2fr]">
          <div>
            <Logo tagline />
            <p className="mt-4 max-w-xs text-[0.88rem] leading-relaxed text-ink-3">
              Pryva is a Nigerian digital services platform for virtual numbers, eSIM data,
              residential proxies and email OTP. Built for people who value calm, reliable access.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-2 text-[0.7rem] font-semibold text-ink-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/80 px-2.5 py-1.5">
                <Card className="h-3.5 w-3.5 text-lav-600" />
                Bank transfer
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/80 px-2.5 py-1.5">
                <Card className="h-3.5 w-3.5 text-lav-600" />
                Card
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/80 px-2.5 py-1.5">
                <Shield className="h-3.5 w-3.5 text-lav-600" />
                Powered by Fleexa
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {columns.map((column) => (
              <div key={column.title}>
                <p className="text-[0.7rem] font-semibold uppercase tracking-[0.18em] text-ink-3">
                  {column.title}
                </p>
                <ul className="mt-4 space-y-2.5">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="text-[0.86rem] text-ink-2 transition-colors hover:text-lav-700"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-line py-6 text-[0.76rem] text-ink-3 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} Pryva Technologies. Made in Lagos, for Nigeria.</p>
          <div className="flex flex-wrap items-center gap-4">
            <span className="inline-flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-lav-500" />
              Naira pricing only
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-lav-500" />
              Auto-refund protection
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
