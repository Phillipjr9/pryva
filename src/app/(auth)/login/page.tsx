import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/AuthForm";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Pryva dashboard to manage your wallet, orders, codes and refunds.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const user = await getCurrentUser();
  const { next, error } = await searchParams;
  const safeNext = next && next.startsWith("/") ? next : "/dashboard";

  if (user) redirect(safeNext);

  return (
    <div className="mx-auto w-full max-w-md rounded-[1.75rem] border border-line bg-[#fffdfa] p-6 shadow-[var(--shadow-card)] sm:p-8">
      <AuthForm mode="login" next={safeNext} errorParam={error ?? null} />
    </div>
  );
}
