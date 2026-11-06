import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth/AuthForm";
import { getCurrentUser, isAdminUser } from "@/lib/identity/auth";
import { operatorHomeFor } from "@/lib/platform/operator";
import { isArenaPreviewHost } from "@/lib/platform/net";
import { safeRedirectPath } from "@/lib/platform/safe-redirect";
import { Shield, Lock } from "@/components/icons";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Operator sign in", robots: { index: false, follow: false } };

/** Where an operator was heading. Anything outside `/admin` is discarded. */
function operatorNext(value: unknown): string {
  const path = safeRedirectPath(value, "/admin");
  return path === "/admin" || path.startsWith("/admin/") ? path : "/admin";
}

/**
 * The operator's door.
 *
 * A separate page rather than a second form on the customer `/login`, for two
 * reasons. The storefront's sign-in is dressed for a customer — a wallet, an
 * eSIM, "secure solutions" — and an operator signing in at 02:00 to freeze a
 * payout should not have to find the staff entrance inside it. And a door that
 * only ever admits operators is a door where "wrong account" is unambiguous: the
 * customer form has no way to say it.
 *
 * This page is a convenience, not a control. It decides where to send you; it does
 * not decide what you may do. `/admin` itself runs `requireAdmin` on every request,
 * so a customer who signs in here and gets redirected to `/dashboard` lost nothing
 * and gained nothing.
 *
 * A signed-in non-administrator is redirected immediately instead of being shown
 * the form, because offering them a form they cannot use is worse than telling
 * them where to go.
 */
export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; denied?: string; bounced?: string }>;
}) {
  const { next, error, denied, bounced } = await searchParams;
  const target = operatorNext(next);
  const user = await getCurrentUser();
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";

  if (user) {
    if (isAdminUser(user)) redirect(target);
    // Signed in, but not an operator: say so here rather than bounce them through
    // the admin layout, which would redirect to the dashboard anyway.
    redirect("/admin/login?denied=1");
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-cream">
      <div className="pointer-events-none absolute left-[-10rem] top-[-10rem] h-[30rem] w-[30rem] rounded-full bg-lav-200/40 blur-[120px]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-12">
        <div className="mb-6 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-lav-200 bg-white px-3 py-1 text-micro font-semibold uppercase tracking-[0.14em] text-lav-800">
            <Shield className="h-3.5 w-3.5" /> Operator console
          </span>
          <h1 className="mt-4 text-[1.5rem] font-medium tracking-tight">Sign in to operate</h1>
          <p className="mx-auto mt-1 max-w-sm text-[0.86rem] leading-relaxed text-ink-2">
            This door is for administrators. Customers sign in from the main site.
          </p>
        </div>

        {bounced === "1" && (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[0.84rem] text-amber-900"
          >
            <strong className="font-semibold">Just signed in and landed back here?</strong>
            <p className="mt-1 leading-relaxed">
              {isArenaPreviewHost(host)
                ? "This preview is embedded, and your browser will not let an embedded page keep the sign-in cookie. Refreshing will not help — open the console in its own tab and sign in there."
                : "The browser may be blocking the session cookie in this embedded page. Try opening the console in its own tab."}
            </p>
            <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
              <a
                href={`/admin/login?next=${encodeURIComponent(target)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold underline underline-offset-2"
              >
                Open the console in a new tab
              </a>
              <a
                href="/api/auth/whoami"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold underline underline-offset-2"
              >
                Check what the server sees
              </a>
            </p>
          </div>
        )}

        {denied === "1" && (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[0.84rem] text-amber-900"
          >
            <strong className="font-semibold">This account is not an administrator.</strong> Sign in
            with an address listed in <code className="text-[0.8rem]">ADMIN_EMAILS</code>, or use{" "}
            <Link href="/dashboard" className="font-medium underline underline-offset-2">
              the customer dashboard
            </Link>
            .
          </div>
        )}

        <div className="rounded-[1.75rem] border border-line bg-[#fffdfa] p-6 shadow-[var(--shadow-card)] sm:p-8">
          <AuthForm mode="login" next={target} errorParam={error ?? null} />
        </div>

        <div className="mt-5 space-y-2 text-center text-meta text-ink-3">
          <p className="flex items-center justify-center gap-1.5">
            <Lock className="h-3.5 w-3.5" /> Administrator accounts need two-factor enabled.
          </p>
          <p>
            <Link href="/login" className="font-medium text-ink-2 underline underline-offset-2">
              Customer sign in
            </Link>
            {" · "}
            <Link href="/" className="font-medium text-ink-2 underline underline-offset-2">
              Back to site
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
