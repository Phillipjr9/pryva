import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/AuthForm";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { planDestination } from "@/lib/plan-destination";
import { normalizeReferralCode } from "@/lib/referral-code";

export const metadata: Metadata = {
  title: "Create your account",
  description:
    "Create a free Pryva account and start buying virtual numbers, eSIM data, residential proxies and email OTP in Naira.",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; plan?: string; ref?: string }>;
}) {
  const user = await getCurrentUser();
  const { next, error, plan, ref } = await searchParams;
  // `?plan=` arrives from every "Get started" button on the catalog pages. An
  // explicit `next` still wins; otherwise the chosen plan decides where the
  // visitor lands, so their selection survives signup instead of being dropped.
  const safeNext = next
    ? safeRedirectPath(next)
    : safeRedirectPath(planDestination(plan), "/dashboard");

  if (user) redirect(safeNext);

  return (
    <div className="mx-auto w-full max-w-md rounded-[1.75rem] border border-line bg-[#fffdfa] p-6 shadow-[var(--shadow-card)] sm:p-8">
      <AuthForm
        mode="signup"
        next={safeNext}
        errorParam={error ?? null}
        refCode={normalizeReferralCode(ref)}
      />
    </div>
  );
}
