import Link from "next/link";
import { ServiceIcon } from "@/components/ServiceIcon";

export const metadata = {
  title: "Digital subscriptions | Pryva",
  description: "Check the availability of digital subscriptions on Pryva.",
};

export default function DigitalServicesPage() {
  return (
    <div className="shell py-16 sm:py-20">
      <div className="mx-auto max-w-2xl rounded-2xl border border-line bg-white p-6 sm:p-10">
        <ServiceIcon service="accounts" size="lg" />
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Digital subscriptions</h1>
        <p className="mt-4 leading-relaxed text-ink-2">Subscriptions are not currently available to order. No price or product availability is being advertised until a delivery service is connected.</p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link href="/accounts" className="btn btn-primary">Explore account listings</Link>
          <Link href="/contact" className="btn btn-ghost">Contact support</Link>
        </div>
      </div>
    </div>
  );
}
