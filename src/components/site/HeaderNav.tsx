"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, Close, Menu } from "@/components/icons";
import { formatNaira } from "@/lib/catalog";
import { BrandLockup } from "@/components/brand/BrandLockup";

type NavUser = { name: string; walletBalance: number } | null;

/**
 * Primary navigation.
 *
 * The per-service dropdown was removed on the owner's instruction: the services
 * are already reachable from the homepage grid, the footer and /pricing, and a
 * nine-item menu in the header buried the things people actually click
 * (Pricing, How it works, Contact). Keep this list short and predictable.
 */
const primaryLinks = [
  { href: "/", label: "Home" },
  { href: "/pricing", label: "Pricing" },
  { href: "/accounts", label: "Accounts" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

export function HeaderNav({ user }: { user: NavUser }) {
  const pathname = usePathname();
  // The drawer is keyed to the route it was opened on: navigating (including via
  // back/forward) closes it without a setState-in-effect.
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const open = menuPath === pathname;
  const setOpen = (next: boolean) => setMenuPath(next ? pathname : null);
  const [scrolled, setScrolled] = useState(false);

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

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <>
      <header
        className={`sticky top-0 z-50 transition-all duration-300 ${
          scrolled
            ? "border-b border-line/80 bg-cream/85 backdrop-blur-xl"
            : "border-b border-transparent bg-transparent"
        }`}
      >
        <div className="shell flex h-[66px] items-center gap-3 sm:h-[74px] sm:gap-6">
          <BrandLockup size="sm" priority />

          <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Main">
            {primaryLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive(link.href) ? "page" : undefined}
                className={`rounded-full px-3.5 py-2 text-[0.86rem] font-medium transition-colors ${
                  isActive(link.href) ? "text-lav-700" : "text-ink-2 hover:text-ink"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto hidden items-center gap-2.5 lg:flex">
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
            className="ml-auto grid h-10 w-10 place-items-center rounded-full border border-line bg-white/70 text-ink lg:hidden"
            aria-label="Open menu"
            aria-expanded={open}
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-[60] bg-cream lg:hidden">
          <div className="shell flex h-[66px] items-center justify-between sm:h-[74px]">
            <BrandLockup size="sm" />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="grid h-10 w-10 place-items-center rounded-full border border-line bg-white text-ink"
              aria-label="Close menu"
            >
              <Close className="h-5 w-5" />
            </button>
          </div>
          <div className="shell h-[calc(100vh-66px)] overflow-y-auto pb-16 sm:h-[calc(100vh-74px)]">
            <div className="mt-2 grid gap-1">
              {primaryLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className={`flex items-center justify-between rounded-xl px-1 py-3 text-[1rem] font-medium ${
                    isActive(link.href) ? "text-lav-700" : "text-ink-2"
                  }`}
                >
                  {link.label}
                  <ArrowRight className="h-4 w-4 text-lav-400" />
                </Link>
              ))}
            </div>

            <div className="mt-6 grid gap-2.5">
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
