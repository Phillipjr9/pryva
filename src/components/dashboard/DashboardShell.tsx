"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CommandPalette, CommandPaletteTrigger } from "@/components/command/CommandPalette";
import {
  ArrowRight,
  Chat,
  Close,
  Grid,
  Logout,
  Menu,
  Plus,
  Receipt,
  Sparkle,
  Wallet,
} from "@/components/icons";
import { ServiceIcon } from "@/components/ServiceIcon";
import { formatNaira } from "@/lib/catalog";

/**
 * Sidebar entries. Product rows carry their own 3D artwork (`art`) so the nav
 * matches the service cards people see on the marketing pages instead of
 * repeating the same generic line icon for five different products.
 */
type NavItem = {
  href: string;
  label: string;
  icon?: (props: { className?: string }) => ReactNode;
  art?: "accounts" | "data" | "gift-cards" | "bulk" | "scheduled" | "proxies";
};

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Overview", icon: Grid },
  { href: "/dashboard/wallet", label: "Wallet", icon: Wallet },
  { href: "/dashboard/orders", label: "Orders", icon: Receipt },
  { href: "/accounts", label: "Accounts", art: "accounts" },
  { href: "/dashboard/data", label: "Data Plans", art: "data" },
  { href: "/dashboard/gift-cards", label: "Gift Cards", art: "gift-cards" },
  { href: "/dashboard/bulk-orders", label: "Bulk Orders", art: "bulk" },
  { href: "/dashboard/scheduled", label: "Scheduled", art: "scheduled" },
  { href: "/dashboard/support", label: "Support", icon: Chat },
];

function LogoutButton({ compact = false }: { compact?: boolean }) {
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/";
    }
  }

  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      className={`flex items-center gap-2 rounded-xl px-3 py-2 text-[0.78rem] font-medium text-ink-3 transition-colors hover:bg-white hover:text-ink disabled:opacity-60 ${
        compact ? "" : "w-full"
      }`}
    >
      <Logout className="h-3.5 w-3.5" />
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}

export function DashboardShell({
  children,
  user,
}: {
  children: ReactNode;
  user: { name: string; email: string; walletBalance: number };
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const initials = user.name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-end lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="grid h-9 w-9 place-items-center rounded-full border border-line bg-white text-ink lg:hidden"
          aria-label="Close menu"
        >
          <Close className="h-4 w-4" />
        </button>
      </div>

      <Link
        href="/dashboard/wallet"
        className="mt-6 block rounded-2xl bg-gradient-to-br from-ink to-[#3b2f56] p-4 text-white"
      >
        <p className="text-[0.58rem] uppercase tracking-[0.16em] text-white/55">Wallet balance</p>
        <p className="mt-1.5 text-[1.35rem] font-semibold leading-none">
          {formatNaira(user.walletBalance)}
        </p>
        <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[0.62rem] font-semibold">
          <Plus className="h-2.5 w-2.5" /> Top up wallet
        </span>
      </Link>

      <nav className="mt-6 grid gap-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[0.85rem] font-medium transition-colors ${
                active
                  ? "bg-lav-100/80 text-lav-800"
                  : "text-ink-2 hover:bg-white hover:text-ink"
              }`}
            >
              {item.art ? (
                <ServiceIcon service={item.art} size="xs" className="overflow-hidden rounded-[5px]" />
              ) : (
                Icon && <Icon className={`h-4 w-4 ${active ? "text-lav-700" : "text-ink-3"}`} />
              )}
              {item.label}
              {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-lav-500" />}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6 rounded-2xl border border-lav-200/70 bg-gradient-to-br from-lav-50 to-white p-4">
        <span className="inline-flex items-center gap-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-lav-700">
          <Sparkle className="h-3 w-3" /> New order
        </span>
        <p className="mt-2 text-[0.78rem] leading-relaxed text-ink-2">
          Numbers, eSIMs, proxies and inboxes start from ₦700.
        </p>
        <Link
          href="/pricing"
          onClick={() => setOpen(false)}
          className="mt-3 inline-flex items-center gap-1 text-[0.76rem] font-semibold text-lav-700 hover:underline"
        >
          Browse services
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="mt-auto border-t border-line pt-4">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-lav-200 to-lav-400 text-[0.66rem] font-bold text-lav-800">
            {initials || "P"}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[0.82rem] font-semibold text-ink">{user.name}</p>
            <p className="truncate text-[0.68rem] text-ink-3">{user.email}</p>
          </div>
        </div>
        <div className="mt-2.5">
          <LogoutButton />
        </div>
      </div>
    </div>
  );

  return (
    <div className="relative min-h-screen bg-cream">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute left-1/3 top-[-14rem] h-[30rem] w-[40rem] rounded-full bg-lav-200/25 blur-[130px]" />
      </div>

      <div className="shell flex min-h-screen gap-6 py-5">
        <aside className="sticky top-5 hidden h-[calc(100vh-2.5rem)] w-[248px] shrink-0 rounded-[1.5rem] border border-line bg-[#fffdfa]/90 p-4 backdrop-blur lg:block">
          {sidebar}
        </aside>

        <div className="min-w-0 flex-1">
          <div className="mb-5 flex items-center justify-between gap-3 rounded-[1.25rem] border border-line bg-[#fffdfa]/80 px-4 py-3 backdrop-blur lg:px-5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="grid h-9 w-9 place-items-center rounded-full border border-line bg-white text-ink lg:hidden"
                aria-label="Open menu"
              >
                <Menu className="h-4 w-4" />
              </button>
              <div>
                <p className="text-[0.68rem] uppercase tracking-[0.16em] text-ink-3">Dashboard</p>
                <p className="text-[0.88rem] font-semibold leading-tight text-ink">
                  Hello, {user.name.split(" ")[0]}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <CommandPaletteTrigger onClick={() => setCommandPaletteOpen(true)} />
              <Link
                href="/dashboard/wallet"
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-[0.74rem] font-semibold text-ink-2 sm:hidden"
              >
                <Wallet className="h-3.5 w-3.5 text-lav-600" />
                {formatNaira(user.walletBalance)}
              </Link>
              <Link
                href="/dashboard/wallet"
                className="hidden items-center gap-1.5 rounded-full border border-line bg-white px-3.5 py-1.5 text-[0.76rem] font-semibold text-ink-2 sm:inline-flex"
              >
                <Wallet className="h-3.5 w-3.5 text-lav-600" />
                {formatNaira(user.walletBalance)}
              </Link>
              <Link
                href="/pricing"
                className="btn btn-primary !px-3.5 !py-2 !text-[0.76rem]"
              >
                Buy
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </div>

          <div className="pb-10">{children}</div>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <button
            type="button"
            aria-label="Close menu overlay"
            className="absolute inset-0 bg-ink/30 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 w-[86%] max-w-[300px] overflow-y-auto rounded-r-[1.5rem] border-r border-line bg-[#fffdfa] p-4 shadow-[var(--shadow-float)]">
            {sidebar}
          </div>
        </div>
      )}

      <CommandPalette isOpen={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
    </div>
  );
}
