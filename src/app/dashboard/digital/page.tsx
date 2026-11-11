import { redirect } from "next/navigation";
export const dynamic = "force-dynamic";
/** Older subscription shop links open the supplier-independent subscription shelf. */
export default function DigitalServicesPage() {
  return redirect("/dashboard/services?category=subscriptions");
}
