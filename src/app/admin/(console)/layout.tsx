import type { ReactNode } from "react";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { count, eq, isNull } from "drizzle-orm";
import { requireAdmin } from "@/lib/identity/auth";
import { db } from "@/db";
import { contactMessages, fraudEvents, supportTickets, withdrawals } from "@/db/schema";
import { isPreviewDatabase } from "@/lib/platform/demo-policy";
import { AdminShell, type AttentionItem } from "@/components/admin/AdminShell";
import "@/styles/adminlte.generated.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { default: "Operator console", template: "%s · Pryva Console" },
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The operator workspace is separate from the customer storefront. AdminLTE's
 * scoped stylesheet supplies the shell/components; React supplies its behavior.
 * requireAdmin remains the authorization boundary for every page in this group.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  /*
   * The one console page exempt from the second-factor gate.
   *
   * This layout is the boundary for everything under `/admin`, including
   * `/admin/account` — the page an unenrolled operator is redirected *to*.
   * Gating it here would send that page back to itself, so the enrolment screen
   * has to be reachable without the enrolment. The exemption is by path because a
   * layout has no knowledge of, and no way to ask, which child route is
   * rendering; every other console page keeps the full check, and the page itself
   * still runs `requireAdmin(..., { allowUnenrolled: true })`, which is what
   * actually authorises it.
   */
  const pathname = await adminRequestPathname();
  const enrolling = pathname !== null && /^\/admin\/account\/?(?:$|[?#])/.test(pathname);
  const operator = enrolling ? await requireAdmin("/admin", { allowUnenrolled: true }) : await requireAdmin();
  const [payouts, tickets, signals, messages] = await Promise.all([
    db.select({ value: count() }).from(withdrawals).where(eq(withdrawals.status, "pending")),
    db.select({ value: count() }).from(supportTickets).where(eq(supportTickets.status, "escalated")),
    db.select({ value: count() }).from(fraudEvents).where(isNull(fraudEvents.reviewedAt)),
    db.select({ value: count() }).from(contactMessages).where(eq(contactMessages.status, "open")),
  ]);
  const attention: AttentionItem[] = [
    { label: "Withdrawals to review", description: "Pending payout requests", count: Number(payouts[0]?.value ?? 0), href: "/admin/withdrawals", kind: "payouts" },
    { label: "Escalated tickets", description: "Customers waiting for a person", count: Number(tickets[0]?.value ?? 0), href: "/admin/support?status=escalated", kind: "support" },
    { label: "Open risk signals", description: "Advisory flags for operator review", count: Number(signals[0]?.value ?? 0), href: "/admin/security", kind: "security" },
    { label: "Open contact messages", description: "Messages from the public form", count: Number(messages[0]?.value ?? 0), href: "/admin/messages", kind: "messages" },
  ];

  return (
    <>
      <AdminShell email={operator.email} name={operator.name} attention={attention} preview={isPreviewDatabase()}>
        {children}
      </AdminShell>
    </>
  );
}

/**
 * The request path, as the edge saw it.
 *
 * Next does not expose the current pathname to a server component, so `proxy.ts`
 * adds it as a request header on every request. It returns null when the header
 * is absent (a test, or a request that bypassed the proxy), and a null path is
 * treated as "not the enrolment screen": the exempt branch is only ever entered
 * on positive evidence, so a missing header keeps the gate closed rather than
 * opening it.
 */
async function adminRequestPathname(): Promise<string | null> {
  const value = (await headers()).get("x-pryva-pathname");
  return value && value.startsWith("/") ? value : null;
}
