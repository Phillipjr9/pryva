import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/AuthForm";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Pryva dashboard to manage your wallet, orders, codes and refunds.",
};

/**
 * Server-rendered notice: the visitor asked for a signed-in page and arrived
 * here instead, which means the browser discarded the session cookie.
 *
 * Deliberately a server component. It used to live inside `AuthForm` (a client
 * component), so any tab running an older bundle could not render it and React
 * raised a hydration mismatch on every visit after a deploy. Server-side state
 * belongs in server components.
 */
function BounceNotice() {
  return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/80 px-3.5 py-3 text-[0.78rem] text-ink">
      <p className="font-semibold text-amber-900">Just signed in and landed back here?</p>
      <p className="mt-1 leading-relaxed text-ink-2">
        The sign-in itself worked — this browser context threw the session cookie
        away. Previews embedded inside another site often do that. Open the
        preview in its own browser tab and sign in once there.
      </p>
      <p className="mt-1.5">
        <a
          href="/api/auth/whoami"
          className="font-semibold text-lav-700 underline underline-offset-2"
        >
          Check what the server sees
        </a>
      </p>
    </div>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; bounced?: string }>;
}) {
  const user = await getCurrentUser();
  const { next, error, bounced } = await searchParams;
  const safeNext = next && next.startsWith("/") ? next : "/dashboard";

  if (user) redirect(safeNext);

  return (
    <div className="mx-auto w-full max-w-md rounded-[1.75rem] border border-line bg-[#fffdfa] p-6 shadow-[var(--shadow-card)] sm:p-8">
      {bounced === "1" ? <BounceNotice /> : null}
      <AuthForm mode="login" next={safeNext} errorParam={error ?? null} />
    </div>
  );
}
