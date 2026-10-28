import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/AuthForm";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { safeRedirectPath } from "@/lib/safe-redirect";

export const metadata: Metadata = {
  title: "Create your account",
  description:
    "Create a free Pryva account and start buying virtual numbers, eSIM data, residential proxies and email OTP in Naira.",
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const user = await getCurrentUser();
  const { next, error } = await searchParams;
  const safeNext = safeRedirectPath(next);

  if (user) redirect(safeNext);

  return (
    <div className="mx-auto w-full max-w-md rounded-[1.75rem] border border-line bg-[#fffdfa] p-6 shadow-[var(--shadow-card)] sm:p-8">
      <AuthForm mode="signup" next={safeNext} errorParam={error ?? null} />
    </div>
  );
}
