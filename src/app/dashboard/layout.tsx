import type { ReactNode } from "react";
import Link from "next/link";
import { and, count, eq } from "drizzle-orm";
import { db } from "@/db";
import { notifications } from "@/db/schema";
import { isAdminUser, requireUser } from "@/lib/auth";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { resendConfigured } from "@/lib/resend-config";
import { BUILD_ID } from "@/lib/build-id";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

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
      isAdmin={isAdminUser(user)}
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
          Demo mode · Payments, balances and services are simulated. This account is shared, so use fictional details only.
        </div>
      )}
      {children}
    </DashboardShell>
  );
}
