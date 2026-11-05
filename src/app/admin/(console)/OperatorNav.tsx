"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BrandLockup } from "@/components/brand/BrandLockup";
import { ChevronDown, Logout, Menu, Close } from "@/components/icons";
import { cn } from "@/lib/utils";

type Item = { href: string; label: string };
type Section = { label: string; items: Item[] };

/**
 * The operator's navigation.
 *
 * Grouped by what an operator is doing rather than alphabetically: money in, money
 * out, what was sold, who is affected, and what has already happened. Nineteen flat
 * links in a wrapping bar is a list you re-read on every page; five sections is a
 * list you learn once.
 *
 * Every destination here is a page that exists. A nav entry pointing at a route
 * that 404s is worse than a missing one, because the operator learns to distrust
 * the whole bar.
 */
const SECTIONS: Section[] = [
  {
    label: "Overview",
    items: [{ href: "/admin", label: "Console home" }],
  },
  {
    label: "Money out",
    items: [
      { href: "/admin/withdrawals", label: "Withdrawals" },
      { href: "/admin/payout-names", label: "Payout names" },
      { href: "/admin/refunds", label: "Refunds" },
    ],
  },
  {
    label: "The books",
    items: [
      { href: "/admin/transactions", label: "Wallet ledger" },
      { href: "/admin/reconciliation", label: "Reconciliation" },
      { href: "/admin/margin", label: "Margin" },
      { href: "/admin/analytics", label: "Analytics" },
    ],
  },
  {
    label: "Selling",
    items: [
      { href: "/admin/orders", label: "Orders" },
      { href: "/admin/services", label: "Services" },
      { href: "/admin/stock", label: "Stock" },
      { href: "/admin/fulfilment", label: "Fulfilment" },
      { href: "/admin/boosting", label: "Boosting" },
    ],
  },
  {
    label: "People",
    items: [
      { href: "/admin/users", label: "Users" },
      { href: "/admin/support", label: "Support" },
      { href: "/admin/messages", label: "Contact form" },
      { href: "/admin/reviews", label: "Reviews" },
    ],
  },
  {
    label: "Trust",
    items: [
      { href: "/admin/security", label: "Security" },
      { href: "/admin/audit", label: "Audit log" },
      { href: "/admin/account", label: "Your account" },
    ],
  },
];

/** Longest-prefix match, so `/admin/users/abc` still highlights Users. */
function activeHref(pathname: string): string | null {
  const all = SECTIONS.flatMap((section) => section.items);
  const matches = all.filter(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  if (matches.length === 0) return null;
  return matches.sort((a, b) => b.href.length - a.href.length)[0]?.href ?? null;
}

export function OperatorNav({ email }: { email: string }) {
  const pathname = usePathname();
  const active = activeHref(pathname);
  const [open, setOpen] = useState(false);

  const links = (onNavigate?: () => void) =>
    SECTIONS.map((section) => (
      <div key={section.label} className="space-y-1">
        <p className="px-3 text-micro font-semibold uppercase tracking-[0.14em] text-ink-3">{section.label}</p>
        <ul className="space-y-0.5">
          {section.items.map((item) => {
            const current = item.href === active;
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={current ? "page" : undefined}
                  className={cn(
                    "block rounded-lg px-3 py-1.5 text-[0.84rem] font-medium transition-colors",
                    current ? "bg-lav-50 text-lav-800" : "text-ink-2 hover:bg-cream hover:text-ink",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    ));

  return (
    <>
      {/* Desktop: a fixed rail. The console is a place you stay in, not a tab. */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 overflow-y-auto border-r border-line bg-white px-4 py-5 lg:flex lg:flex-col">
        <Link href="/admin" className="mb-5 flex items-center gap-2 px-1">
          <BrandLockup size="xs" />
        </Link>
        <span className="mb-4 self-start rounded-full bg-lav-100 px-2 py-0.5 text-micro font-semibold uppercase tracking-[0.12em] text-lav-800">
          Operator console
        </span>
        <nav aria-label="Operator sections" className="flex-1 space-y-4">
          {links()}
        </nav>
        <div className="mt-5 space-y-2 border-t border-line pt-4">
          <p className="truncate px-3 text-micro text-ink-3" title={email}>
            {email}
          </p>
          <Link
            href="/dashboard"
            className="block rounded-lg px-3 py-1.5 text-[0.82rem] font-medium text-ink-2 hover:bg-cream"
          >
            Your customer account
          </Link>
        </div>
      </aside>

      {/* Mobile: the same sections behind one disclosure. */}
      <div className="sticky top-0 z-30 border-b border-line bg-white lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <Link href="/admin" className="flex items-center gap-2">
            <BrandLockup size="xs" />
            <span className="rounded-full bg-lav-100 px-2 py-0.5 text-micro font-semibold uppercase tracking-[0.1em] text-lav-800">
              Operator
            </span>
          </Link>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls="operator-menu"
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[0.8rem] font-medium text-ink"
          >
            {open ? <Close className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            Sections
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
          </button>
        </div>
        {open && (
          <nav
            id="operator-menu"
            aria-label="Operator sections"
            className="max-h-[70vh] space-y-4 overflow-y-auto border-t border-line px-4 py-4"
          >
            {links(() => setOpen(false))}
            <div className="space-y-0.5 border-t border-line pt-3">
              <p className="truncate px-3 text-micro text-ink-3">{email}</p>
              <Link
                href="/dashboard"
                onClick={() => setOpen(false)}
                className="block rounded-lg px-3 py-1.5 text-[0.82rem] font-medium text-ink-2 hover:bg-cream"
              >
                Your customer account
              </Link>
            </div>
          </nav>
        )}
      </div>
    </>
  );
}

/**
 * Sign out of the console entirely.
 *
 * `/api/auth/logout` is a same-origin POST that answers with JSON, so a plain
 * `<form>` would leave the operator looking at `{"ok":true}`. This calls it and
 * then goes to the operator door, so signing out of the console lands you where
 * you sign back in rather than in the storefront you were not using.
 */
export function OperatorSignOut({ variant = "rail" }: { variant?: "rail" | "inline" }) {
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" } });
    } finally {
      window.location.replace("/admin/login");
    }
  }

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={pending}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg font-medium text-ink-2 hover:bg-cream disabled:opacity-50",
        variant === "rail" ? "px-3 py-1.5 text-[0.82rem]" : "px-3 py-1.5 text-[0.84rem]",
      )}
    >
      <Logout className="h-3.5 w-3.5" /> {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
