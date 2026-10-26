import { HeaderNav } from "@/components/site/HeaderNav";
import { getCurrentUser } from "@/lib/auth";

export async function SiteHeader() {
  let user: { name: string; walletBalance: number } | null = null;
  try {
    const current = await getCurrentUser();
    if (current) user = { name: current.name, walletBalance: current.walletBalance };
  } catch {
    user = null;
  }

  return <HeaderNav user={user} />;
}
