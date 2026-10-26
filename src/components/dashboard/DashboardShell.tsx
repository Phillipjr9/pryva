"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
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
import { formatNaira } from "@/lib/catalog";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: Grid },
  { href: "/dashboard/wallet", label: "Wallet", icon: Wallet },
  { href: "/dashboard/orders", label: "Orders", icon: Receipt },
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
      className={`pryva-dashboard-logout flex items-center gap-2 px-3 py-2 text-[0.78rem] font-medium transition-colors disabled:opacity-60 ${
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
  const initials = user.name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const isActive = (href: string) =>
    href === "/dashboard" ? pathname === href : pathname.startsWith(href);

  const sidebar = (
    <div className="pryva-dashboard-sidebar-inner flex h-full flex-col">
      <div className="pryva-dashboard-brand-row flex items-center justify-between">
        <Logo />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="pryva-dashboard-close grid h-9 w-9 place-items-center"
          aria-label="Close menu"
        >
          <Close className="h-4 w-4" />
        </button>
      </div>

      <Link
        href="/dashboard/wallet"
        onClick={() => setOpen(false)}
        className="pryva-dashboard-balance mt-6 block"
      >
        <span className="pryva-dashboard-balance-label">Available balance</span>
        <strong>{formatNaira(user.walletBalance)}</strong>
        <span className="pryva-dashboard-balance-foot">
          Wallet activity <ArrowRight className="h-3 w-3" />
        </span>
      </Link>

      <p className="pryva-dashboard-nav-label">Workspace</p>
      <nav className="pryva-dashboard-nav grid gap-1" aria-label="Dashboard">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              aria-current={active ? "page" : undefined}
              className={`pryva-dashboard-nav-link flex items-center gap-2.5 px-3 py-2.5 text-[0.85rem] font-medium transition-colors ${
                active ? "is-active" : ""
              }`}
            >
              <Icon className="h-4 w-4" />
              {item.label}
              {active && <span className="pryva-dashboard-nav-dot ml-auto" />}
            </Link>
          );
        })}
      </nav>

      <div className="pryva-dashboard-promo mt-6">
        <span className="pryva-dashboard-promo-label">
          <Sparkle className="h-3 w-3" /> Pryva services
        </span>
        <p>Numbers, eSIMs, proxies and inboxes — choose what you need.</p>
        <Link href="/pricing" onClick={() => setOpen(false)}>
          Browse services <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="pryva-dashboard-user mt-auto">
        <div className="pryva-dashboard-user-row flex items-center gap-2.5">
          <span className="pryva-dashboard-avatar grid h-9 w-9 shrink-0 place-items-center">
            {initials || "P"}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[0.82rem] font-semibold">{user.name}</p>
            <p className="truncate text-[0.68rem]">{user.email}</p>
          </div>
        </div>
        <div className="mt-2.5">
          <LogoutButton />
        </div>
      </div>
    </div>
  );

  return (
    <div className="pryva-dashboard min-h-screen">
      <div className="pryva-dashboard-ambient" aria-hidden="true" />

      <div className="pryva-dashboard-shell">
        <aside className="pryva-dashboard-sidebar">{sidebar}</aside>

        <div className="pryva-dashboard-content min-w-0">
          <header className="pryva-dashboard-topbar">
            <div className="pryva-dashboard-topbar-inner">
              <div className="pryva-dashboard-topbar-greeting">
                <button
                  type="button"
                  onClick={() => setOpen(true)}
                  className="pryva-dashboard-menu grid h-9 w-9 place-items-center"
                  aria-label="Open dashboard menu"
                  aria-expanded={open}
                >
                  <Menu className="h-4 w-4" />
                </button>
                <div>
                  <span>PRYVA · ACCOUNT</span>
                  <strong>Hello, {user.name.split(" ")[0]}</strong>
                </div>
              </div>

              <div className="pryva-dashboard-topbar-actions">
                <Link href="/dashboard/wallet" className="pryva-dashboard-top-balance">
                  <Wallet className="h-4 w-4" />
                  <span>Wallet</span>
                  <strong>{formatNaira(user.walletBalance)}</strong>
                </Link>
                <Link href="/pricing" className="pryva-dashboard-shop">
                  <Plus className="h-3.5 w-3.5" />
                  Browse services
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          </header>

          <main className="pryva-dashboard-body">{children}</main>
        </div>
      </div>

      {open && (
        <div className="pryva-dashboard-mobile-overlay">
          <button
            type="button"
            aria-label="Close dashboard menu"
            className="pryva-dashboard-mobile-scrim"
            onClick={() => setOpen(false)}
          />
          <div
            className="pryva-dashboard-mobile-panel"
            role="dialog"
            aria-modal="true"
            aria-label="Dashboard navigation"
          >
            {sidebar}
          </div>
        </div>
      )}
    </div>
  );
}
