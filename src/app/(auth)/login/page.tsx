import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/AuthForm";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { planDestination } from "@/lib/plan-destination";
import { headers } from "next/headers";
import { isArenaPreviewHost } from "@/lib/net";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Pryva dashboard to manage your wallet, orders, codes and refunds.",
};

/**
 * Server-rendered notice: the visitor asked for a signed-in page and arrived
 * here instead. If they just signed in, an embedded browser may have blocked
 * the session cookie; an ordinary unauthenticated visit can also reach here.
 *
 * Deliberately a server component. It used to live inside `AuthForm` (a client
 * component), so any tab running an older bundle could not render it and React
 * raised a hydration mismatch on every visit after a deploy. Server-side state
 * belongs in server components.
 */
function BounceNotice({ arenaPreview }: { arenaPreview: boolean }) {
  return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/80 px-3.5 py-3 text-[0.78rem] text-ink">
      <p className="font-semibold text-amber-900">Just signed in and landed back here?</p>
      <p className="mt-1 leading-relaxed text-ink-2">
        {arenaPreview
          ? "This preview is embedded, and your browser will not let an embedded page keep the sign-in cookie. Refreshing will not help — open the preview in its own tab and sign in there."
          : "The browser may be blocking the session cookie in this embedded page. Try opening the sign-in page in its own tab."}
      </p>
      <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
        {/*
          Offered in both cases, including the embedded preview. It used to be
          hidden when the preview host was detected, which removed the one
          workaround exactly where it is needed: a browser that refuses site
          storage in an embedded page cannot be fixed by refreshing it, but the
          SameSite=Lax session cookie works normally once the page is top-level.
        */}
        <a href="/login" target="_blank" rel="noopener noreferrer" className="font-semibold text-lav-700 underline underline-offset-2">
          Open sign-in in a new tab
        </a>
        <a href="/api/auth/whoami" className="font-semibold text-lav-700 underline underline-offset-2">
          Check what the server sees
        </a>
      </p>
    </div>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; bounced?: string; plan?: string }>;
}) {
  const user = await getCurrentUser();
  const { next, error, bounced, plan } = await searchParams;
  // Catalog links carry `?plan=`; keep that choice as the post-sign-in
  // destination when no explicit `next` was supplied.
  const safeNext = next
    ? safeRedirectPath(next)
    : safeRedirectPath(planDestination(plan), "/dashboard");
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "";

  if (user) redirect(safeNext);

  return (
    <div className="mx-auto w-full max-w-md rounded-[1.75rem] border border-line bg-[#fffdfa] p-6 shadow-[var(--shadow-card)] sm:p-8">
      {bounced === "1" ? <BounceNotice arenaPreview={isArenaPreviewHost(host)} /> : null}
      <AuthForm mode="login" next={safeNext} errorParam={error ?? null} />
    </div>
  );
}
