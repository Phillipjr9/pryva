import { requireAdmin } from "@/lib/identity/auth";
import { PageHeading } from "@/components/admin/AdminUi";
import { IntegrityConsole } from "./IntegrityConsole";

export const dynamic = "force-dynamic";
export const metadata = { title: "Integrity checks" };

export default async function IntegrityPage() {
  await requireAdmin("/admin/integrity");
  return <div className="console-page"><PageHeading title="Integrity checks" description="Check recorded wallet balances and order transactions for inconsistencies." /><IntegrityConsole /></div>;
}
