import type { Metadata } from "next";
import { requireUser } from "@/lib/identity/auth";
import { ProxyShop } from "./ProxyShop";

export const metadata: Metadata = { title: "Residential proxies" };
export const dynamic = "force-dynamic";

export default async function DashboardProxiesPage() {
  await requireUser("/dashboard/proxies");
  return <ProxyShop />;
}
