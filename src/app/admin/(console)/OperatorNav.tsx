"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ComponentType } from "react";
import { BrandMark } from "@/components/brand/BrandLockup";
import {
  Activity, ArrowUpRight, BarChart3, Bolt, Card, CheckCircle, Clock, FileText,
  Gift, Globe, Grid, Logout, MessageCircle, Receipt, Refresh, Shield,
  ShoppingCart, Star, Users, Wallet,
} from "@/components/icons";

type NavItem = { href: string; label: string; icon?: ComponentType<{ className?: string }> };
type NavSection = { label: string; items: NavItem[] };

/** One source of truth for the sidebar, command search and page breadcrumbs. */
export const ADMIN_SECTIONS: NavSection[] = [
  {
    label: "Workspace",
    items: [
      { href: "/admin", label: "Dashboard", icon: Grid },
      { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
    ],
  },
  {
    label: "Commerce",
    items: [
      { href: "/admin/orders", label: "Orders", icon: ShoppingCart },
      { href: "/admin/fulfilment", label: "Fulfilment", icon: Receipt },
      { href: "/admin/services", label: "Services", icon: Globe },
      { href: "/admin/stock", label: "Stock", icon: Gift },
      { href: "/admin/suppliers", label: "Suppliers", icon: Activity },
      { href: "/admin/boosting", label: "Boosting", icon: Bolt },
    ],
  },
  {
    label: "Finance",
    items: [
      { href: "/admin/transactions", label: "Wallet ledger", icon: Wallet },
      { href: "/admin/withdrawals", label: "Withdrawals", icon: ArrowUpRight },
      { href: "/admin/refunds", label: "Refunds", icon: Refresh },
      { href: "/admin/payout-names", label: "Payout names", icon: Card },
      { href: "/admin/anomalies", label: "Payout anomalies", icon: Shield },
      { href: "/admin/reconciliation", label: "Reconciliation", icon: CheckCircle },
      { href: "/admin/integrity", label: "Integrity checks", icon: FileText },
      { href: "/admin/margin", label: "Realised margin", icon: BarChart3 },
    ],
  },
  {
    label: "Customers",
    items: [
      { href: "/admin/users", label: "Users", icon: Users },
      { href: "/admin/support", label: "Support" },
      { href: "/admin/messages", label: "Contact form" },
      { href: "/admin/reviews", label: "Reviews", icon: Star },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/admin/security", label: "Security", icon: Shield },
      { href: "/admin/health", label: "Operational health", icon: Activity },
      { href: "/admin/audit", label: "Audit log", icon: Clock },
      { href: "/admin/retention", label: "Data retention", icon: FileText },
      { href: "/admin/account", label: "Operator account", icon: Users },
    ],
  },
];

export const ADMIN_NAV_ITEMS = ADMIN_SECTIONS.flatMap((section) =>
  section.items.map((item) => ({ ...item, section: section.label })),
);

/** `/admin` redirects to the overview; both names describe the same destination. */
export function adminSectionFor(pathname: string) {
  const normalized = pathname === "/admin/overview" || pathname === "/admin/dashboard" ? "/admin" : pathname;
  return ADMIN_NAV_ITEMS
    .filter((item) => normalized === item.href || normalized.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0] ?? null;
}

export function OperatorNav({
  email,
  name,
  mobileOpen,
  onNavigate,
}: {
  email: string;
  name: string;
  mobileOpen: boolean;
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  const active = adminSectionFor(pathname)?.href;

  return (
    <aside className="app-sidebar" id="operator-sidebar" data-mobile-open={mobileOpen}>
      <div className="sidebar-brand">
        <Link href="/admin" className="brand-link" onClick={onNavigate} aria-label="Pryva admin dashboard">
          <BrandMark size="sm" />
          <span className="brand-text">Pryva</span>
          <span className="console-brand-tag">ADMIN</span>
        </Link>
      </div>
      <div className="sidebar-operator">
        <span className="sidebar-operator-avatar" aria-hidden="true">{name.charAt(0).toUpperCase()}</span>
        <div className="min-w-0">
          <div className="sidebar-operator-name text-truncate" title={email}>{name}</div>
          <div className="sidebar-operator-role"><span className="status-dot text-success" /> Administrator</div>
        </div>
      </div>
      <div className="sidebar-wrapper">
        <nav aria-label="Operator sections">
          <ul className="nav sidebar-menu flex-column" role="list">
            {ADMIN_SECTIONS.map((section) => (
              <li className="nav-item" key={section.label}>
                <p className="nav-header">{section.label}</p>
                <ul className="nav flex-column" role="list">
                  {section.items.map((item) => {
                    const Icon = item.icon ?? MessageCircle;
                    const current = item.href === active;
                    return (
                      <li className="nav-item" key={item.href}>
                        <Link
                          href={item.href}
                          onClick={onNavigate}
                          aria-current={current ? "page" : undefined}
                          className={`nav-link${current ? " active" : ""}`}
                          title={item.label}
                        >
                          <Icon className="nav-icon" />
                          <p>{item.label}</p>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="sidebar-footer">
        <Link href="/" onClick={onNavigate}><Globe className="h-4 w-4" /> View storefront <ArrowUpRight className="ms-auto h-3 w-3" /></Link>
        <p>Pryva operator workspace</p>
      </div>
    </aside>
  );
}

/** Keep the JSON logout endpoint out of a plain form navigation. */
export function OperatorSignOut() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" } });
      if (!response.ok) throw new Error("Sign out failed");
      window.location.replace("/admin/login");
    } catch {
      setError("Could not sign out. Please try again.");
      setPending(false);
    }
  }

  return (
    <div>
      <button type="button" className="popover-row" onClick={() => void signOut()} disabled={pending}>
        <Logout /> {pending ? "Signing out…" : "Sign out"}
      </button>
      {error && <p role="alert" className="px-3 pb-2 mb-0 small text-danger">{error}</p>}
    </div>
  );
}
