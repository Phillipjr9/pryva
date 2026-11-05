import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { isAdminUser, requireUser } from "@/lib/identity/auth";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { isPreviewDatabase } from "@/lib/platform/demo-policy";
import { resendConfigured } from "@/lib/email/resend-config";
import { BUILD_ID } from "@/lib/platform/build-id";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  /*
   * The console and the storefront are two products now, not one product with a
   * tab. An operator who lands here is put back on their own surface -- which is
   * the point of the split: the dashboard's wallet, its cart, its "explore
   * services" rail and its balance chip all describe a person spending money,
   * and showing them to the account that approves withdrawals is how an operator
   * mistakes a customer view for a control panel.
   *
   * This is a redirect, not a hiding: every customer page underneath re-checks
   * `requireUser` on its own, and the console re-checks `requireAdmin`. Nothing
   * is left reachable-but-invisible.
   */
  if (isAdminUser(user)) redirect("/admin");

  // The bell lives in the shell, so the unread count is fetched once here rather
  // than by every page.
  const [unread] = await db
    .select({ value: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, user.id), eq(notifications.read, 0)));

  return (
    <DashboardShell
      user={{ name: user.name, email: user.email, walletBalance: user.walletBalance }}
      unreadNotifications={Number(unread?.value ?? 0)}
      buildId={BUILD_ID}
    >
      {/*
        /verify-email existed with no link to it anywhere in the app, so the only
        way to reach it was to type the URL -- and verification is what gates
        administrator access, password-recovery confidence and proof of mailbox
        ownership. Shown only when mail can actually be delivered: prompting
        someone to request a link that the server cannot send would repeat the
        false promise the resend endpoint was just fixed to stop making.
      */}
      {!user.emailVerifiedAt && resendConfigured() && (
        <div
          role="note"
          className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700"
        >
          <span>
            <strong className="font-semibold text-slate-900">Confirm your email.</strong>{" "}
            {user.email} is not verified yet.
          </span>
          <Link
            className="font-semibold text-lav-700 underline underline-offset-2 hover:text-lav-800"
            href="/verify-email"
          >
            Send the confirmation link
          </Link>
        </div>
      )}
      {isPreviewDatabase() && (
        <div role="status" className="mb-5 rounded-xl border border-lav-200 bg-lav-50 px-4 py-3 text-sm text-lav-800">
          This deployment has no persistent database. Purchases and payments are unavailable, and any data entered here will not persist.
        </div>
      )}
      {children}
    </DashboardShell>
  );
}
