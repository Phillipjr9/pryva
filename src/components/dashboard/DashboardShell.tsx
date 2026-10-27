"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CommandPalette, CommandPaletteTrigger } from "@/components/command/CommandPalette";
import {
  ArrowRight,
  Bell,
  Chat,
  Close,
  Grid,
  Logout,
  Menu,
  Plus,
  Receipt,
  Settings,
  Shield,
  Sparkle,
  Wallet,
} from "@/components/icons";
import { ServiceIcon } from "@/components/ServiceIcon";
import { BrandLockup } from "@/components/brand/BrandLockup";
import { formatNaira, serviceMap } from "@/lib/catalog";

/**
 * Sidebar entries are grouped by what the customer is trying to do — manage what
 * they already bought, buy something new, or change their account. The previous
 * flat list mixed /accounts (which leaves the dashboard for the marketing page)
 * with dashboard routes and hid Notifications, Security and Settings entirely.
 */
type NavItem = {
  href: string;
  label: string;
  icon?: (props: { className?: string }) => ReactNode;
  art?: "accounts" | "data" | "gift-cards" | "bulk" | "scheduled" | "proxies";
};

const navGroups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Manage",
    items: [
      { href: "/dashboard", label: "Overview", icon: Grid },
      { href: "/dashboard/orders", label: "Orders", icon: Receipt },
      { href: "/dashboard/wallet", label: "Wallet", icon: Wallet },
    ],
  },
  {
    label: "Buy",
    items: [
      { href: "/accounts", label: "Accounts", art: "accounts" },
      { href: "/dashboard/data", label: "Data Plans", art: "data" },
      { href: "/dashboard/gift-cards", label: "Gift Cards", art: "gift-cards" },
      { href: "/dashboard/bulk-orders", label: "Bulk Orders", art: "bulk" },
      { href: "/dashboard/scheduled", label: "Scheduled", art: "scheduled" },
    ],
  },
  {
    label: "You",
    items: [
      { href: "/dashboard/notifications", label: "Notifications", icon: Bell },
      { href: "/dashboard/security", label: "Security", icon: Shield },
      { href: "/dashboard/settings", label: "Settings", icon: Settings },
      { href: "/dashboard/support", label: "Support", icon: Chat },
    ],
  },
];

/** The five things worth a thumb-reach on a phone. */
const mobileTabs: Array<{ href: string; label: string; icon: NavItem["icon"] }> = [
  { href: "/dashboard", label: "Home", icon: Grid },
  { href: "/dashboard/orders", label: "Orders", icon: Receipt },
  { href: "/dashboard/wallet", label: "Wallet", icon: Wallet },
  { href: "/pricing", label: "Buy", icon: Sparkle },
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

function isRouteActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === href;
  if (href === "/dashboard/orders") return pathname.startsWith("/dashboard/orders");
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DashboardShell({
  children,
  user,
  unreadNotifications = 0,
}: {
  children: ReactNode;
  user: { name: string; email: string; walletBalance: number };
  unreadNotifications?: number;
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

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between lg:hidden">
        <BrandLockup size="sm" />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="grid h-9 w-9 place-items-center rounded-full border border-line bg-white text-ink"
          aria-label="Close menu"
        >
          <Close className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-5 hidden lg:block">
        <BrandLockup size="sm" />
      </div>

      <Link
        href="/dashboard/wallet"
        onClick={() => setOpen(false)}
        className="mt-5 block rounded-2xl bg-gradient-to-br from-ink to-[#3b2f56] p-4 text-white"
      >
        <p className="text-[0.58rem] uppercase tracking-[0.16em] text-white/55">Wallet balance</p>
        <p className="mt-1.5 text-[1.35rem] font-semibold leading-none">
          {formatNaira(user.walletBalance)}
        </p>
        <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[0.62rem] font-semibold">
          <Plus className="h-2.5 w-2.5" /> Top up wallet
        </span>
      </Link>

      <nav className="mt-5 grid gap-4 overflow-y-auto">
        {navGroups.map((group) => (
          <div key={group.label} className="grid gap-0.5">
            <p className="px-3 text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-ink-3">
              {group.label}
            </p>
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = isRouteActive(pathname, item.href);
              const badge =
                item.href === "/dashboard/notifications" && unreadNotifications > 0
                  ? unreadNotifications
                  : null;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-[0.84rem] font-medium transition-colors ${
                    active ? "bg-lav-100/80 text-lav-800" : "text-ink-2 hover:bg-white hover:text-ink"
                  }`}
                >
                  {item.art ? (
                    <ServiceIcon service={item.art} size="xs" className="overflow-hidden rounded-[5px]" />
                  ) : (
                    Icon && <Icon className={`h-4 w-4 ${active ? "text-lav-700" : "text-ink-3"}`} />
                  )}
                  {item.label}
                  {badge ? (
                    <span className="ml-auto rounded-full bg-lav-600 px-1.5 py-0.5 text-[0.6rem] font-bold text-white">
                      {badge}
                    </span>
                  ) : (
                    active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-lav-500" />
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="mt-5 rounded-2xl border border-lav-200/70 bg-gradient-to-br from-lav-50 to-white p-4">
        <span className="inline-flex items-center gap-1.5 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-lav-700">
          <Sparkle className="h-3 w-3" /> New order
        </span>
        <p className="mt-2 text-[0.78rem] leading-relaxed text-ink-2">
          Numbers, eSIMs, proxies and inboxes start from{" "}
          {formatNaira(serviceMap["email-otp"].fromPrice)}.
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

      <div className="shell flex min-h-screen gap-6 py-4 lg:py-5">
        <aside className="sticky top-5 hidden h-[calc(100vh-2.5rem)] w-[248px] shrink-0 rounded-[1.5rem] border border-line bg-[#fffdfa]/90 p-4 backdrop-blur lg:block">
          {sidebar}
        </aside>

        <div className="min-w-0 flex-1">
          <div className="mb-4 flex items-center justify-between gap-3 rounded-[1.25rem] border border-line bg-[#fffdfa]/80 px-3 py-2.5 backdrop-blur lg:mb-5 lg:px-5 lg:py-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-white text-ink lg:hidden"
                aria-label="Open menu"
              >
                <Menu className="h-4 w-4" />
              </button>
              <span className="lg:hidden">
                <BrandLockup size="xs" />
              </span>
              <div className="hidden lg:block">
                <p className="text-[0.68rem] uppercase tracking-[0.16em] text-ink-3">Dashboard</p>
                <p className="text-[0.88rem] font-semibold leading-tight text-ink">
                  Hello, {user.name.split(" ")[0]}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <div className="hidden sm:block">
                <CommandPaletteTrigger onClick={() => setCommandPaletteOpen(true)} />
              </div>
              <Link
                href="/dashboard/notifications"
                className="relative grid h-9 w-9 place-items-center rounded-full border border-line bg-white text-ink-2 transition-colors hover:text-ink"
                aria-label={
                  unreadNotifications > 0
                    ? `Notifications, ${unreadNotifications} unread`
                    : "Notifications"
                }
              >
                <Bell className="h-4 w-4" />
                {unreadNotifications > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-lav-600 px-1 text-[0.58rem] font-bold text-white">
                    {unreadNotifications}
                  </span>
                )}
              </Link>
              <Link
                href="/dashboard/wallet"
                className="hidden items-center gap-1.5 rounded-full border border-line bg-white px-3.5 py-1.5 text-[0.76rem] font-semibold text-ink-2 md:inline-flex"
              >
                <Wallet className="h-3.5 w-3.5 text-lav-600" />
                {formatNaira(user.walletBalance)}
              </Link>
              <Link href="/pricing" className="btn btn-primary !px-3.5 !py-2 !text-[0.76rem]">
                Buy
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </div>

          <div className="pb-24 lg:pb-10">{children}</div>
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

      {/* Thumb-reach navigation. The old mobile top bar squeezed five controls
          into 390px and left nothing reachable one-handed. */}
      <nav
        aria-label="Dashboard sections"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-[#fffdfa]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
      >
        <div className="mx-auto flex max-w-md items-stretch justify-between px-1.5">
          {mobileTabs.map((tab) => {
            const Icon = tab.icon;
            const active = isRouteActive(pathname, tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-1 flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-[0.6rem] font-semibold transition-colors ${
                  active ? "text-lav-700" : "text-ink-3 hover:text-ink"
                }`}
              >
                <span
                  className={`grid h-7 w-9 place-items-center rounded-full ${
                    active ? "bg-lav-100" : ""
                  }`}
                >
                  {Icon && <Icon className="h-4 w-4" />}
                </span>
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <CommandPalette isOpen={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />
    </div>
  );
}
