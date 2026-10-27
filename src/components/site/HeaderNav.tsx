"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { ArrowRight, ChevronDown, Close, Menu } from "@/components/icons";
import { formatNaira, services } from "@/lib/catalog";

type NavUser = { name: string; walletBalance: number } | null;

const primaryLinks = [
  { href: "/accounts", label: "Accounts" },
  { href: "/pricing", label: "Pricing" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

export function HeaderNav({ user }: { user: NavUser }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (!dropdownRef.current?.contains(event.target as Node)) setServicesOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      <header
        className={`sticky top-0 z-50 transition-all duration-300 ${
          scrolled
            ? "border-b border-line/80 bg-cream/85 backdrop-blur-xl"
            : "border-b border-transparent bg-transparent"
        }`}
      >
      <div className="shell flex h-[74px] items-center justify-between gap-4">
        <Logo tagline={false} />

        <nav className="hidden items-center gap-1 lg:flex">
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setServicesOpen((value) => !value)}
              aria-expanded={servicesOpen}
              className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[0.86rem] font-medium transition-colors ${
                services.some((service) => isActive(service.href))
                  ? "text-lav-700"
                  : "text-ink-2 hover:text-ink"
              }`}
            >
              Services
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${servicesOpen ? "rotate-180" : ""}`}
              />
            </button>
            {servicesOpen && (
              <div className="absolute left-0 top-[calc(100%+10px)] w-[460px] rounded-3xl border border-line bg-[#fffdfa] p-2.5 shadow-[var(--shadow-float)]">
                <div className="grid gap-1 sm:grid-cols-2">
                  {services.map((service) => (
                    <Link
                      key={service.slug}
                      href={service.href}
                      onClick={() => setServicesOpen(false)}
                      className="group rounded-2xl px-3.5 py-3 transition-colors hover:bg-lav-50"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[0.9rem] font-semibold text-ink">{service.name}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-lav-500 opacity-0 transition-opacity group-hover:opacity-100" />
                      </span>
                      <span className="mt-1 block text-[0.78rem] leading-snug text-ink-3">
                        {service.description}
                      </span>
                    </Link>
                  ))}
                </div>
                <Link
                  href="/pricing"
                  className="mt-1.5 flex items-center justify-between rounded-2xl bg-lav-50 px-4 py-3 text-[0.8rem] font-semibold text-lav-700 transition-colors hover:bg-lav-100"
                >
                  See all pricing and bundles
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            )}
          </div>

          {primaryLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setServicesOpen(false)}
              className={`rounded-full px-3.5 py-2 text-[0.86rem] font-medium transition-colors ${
                isActive(link.href) ? "text-lav-700" : "text-ink-2 hover:text-ink"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2.5 lg:flex">
          {user ? (
            <>
              <Link
                href="/dashboard/wallet"
                className="hidden items-center gap-2 rounded-full border border-line bg-white/70 px-3.5 py-2 text-[0.8rem] font-semibold text-ink-2 xl:flex"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                {formatNaira(user.walletBalance)}
              </Link>
              <Link href="/dashboard" className="btn btn-dark !px-5 !py-2.5 !text-[0.83rem]">
                Dashboard
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-full px-3.5 py-2 text-[0.86rem] font-medium text-ink-2 transition-colors hover:text-ink"
              >
                Sign in
              </Link>
              <Link href="/signup" className="btn btn-primary !px-5 !py-2.5 !text-[0.83rem]">
                Get started
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setOpen(true)}
          className="grid h-10 w-10 place-items-center rounded-full border border-line bg-white/70 text-ink lg:hidden"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-[60] bg-cream lg:hidden">
          <div className="shell flex h-[74px] items-center justify-between">
            <Logo />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="grid h-10 w-10 place-items-center rounded-full border border-line bg-white text-ink"
              aria-label="Close menu"
            >
              <Close className="h-5 w-5" />
            </button>
          </div>
          <div className="shell h-[calc(100vh-74px)] overflow-y-auto pb-12">
            <p className="eyebrow mt-2">Services</p>
            <div className="mt-3 grid gap-2">
              {services.map((service) => (
                <Link
                  key={service.slug}
                  href={service.href}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between rounded-2xl border border-line bg-white px-4 py-3.5"
                >
                  <span>
                    <span className="block text-[0.95rem] font-semibold">{service.name}</span>
                    <span className="text-[0.78rem] text-ink-3">{service.eyebrow}</span>
                  </span>
                  <ArrowRight className="h-4 w-4 text-lav-500" />
                </Link>
              ))}
            </div>
            <p className="eyebrow mt-7">Company</p>
            <div className="mt-3 grid gap-1.5">
              {primaryLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="rounded-xl px-1 py-2.5 text-[0.95rem] font-medium text-ink-2"
                >
                  {link.label}
                </Link>
              ))}
            </div>
            <div className="mt-7 grid gap-2.5">
              {user ? (
                <Link href="/dashboard" className="btn btn-primary w-full">
                  Go to dashboard
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ) : (
                <>
                  <Link href="/signup" className="btn btn-primary w-full">
                    Create your account
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link href="/login" className="btn btn-ghost w-full">
                    Sign in
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
