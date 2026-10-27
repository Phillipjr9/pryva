"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin/dashboard", label: "Overview" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/withdrawals", label: "Withdrawals" },
  { href: "/admin/analytics", label: "Analytics" },
  { href: "/admin/security", label: "Security" },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <header className="border-b border-line bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
        <Link href="/admin/dashboard" className="text-[0.95rem] font-semibold text-ink">
          Pryva admin
        </Link>

        <nav className="flex flex-1 flex-wrap items-center gap-1">
          {LINKS.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "rounded-lg bg-lav-50 px-3 py-1.5 text-[0.84rem] font-medium text-lav-800"
                    : "rounded-lg px-3 py-1.5 text-[0.84rem] font-medium text-ink-2 hover:bg-cream"
                }
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <Link
          href="/dashboard"
          className="rounded-lg border border-line px-3 py-1.5 text-[0.8rem] font-medium text-ink-2 hover:border-lav-300"
        >
          Exit admin
        </Link>
      </div>
    </header>
  );
}
