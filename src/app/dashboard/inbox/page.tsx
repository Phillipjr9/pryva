import Link from "next/link";
import { InboxManager } from "./InboxManager";
import { requireUser } from "@/lib/identity/auth";
import { ServiceTitle } from "@/components/ServiceTitle";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Temporary inbox · Pryva",
};

export default async function InboxPage() {
  await requireUser("/dashboard/inbox");

  return (
    <div className="space-y-6">
      <div>
        <ServiceTitle service="email-otp">Temporary inbox</ServiceTitle>
        <p className="mt-1 max-w-xl text-[0.875rem] leading-relaxed text-ink-2">
          A free inbox for reading one verification code. Create it, use the address, and discard it
          when you are done — nothing is stored afterwards.
        </p>
      </div>
      <div role="note" className="rounded-xl border border-lav-200 bg-lav-50/60 p-4 text-meta leading-relaxed text-ink-2">
        <p><strong className="text-ink">Looking to buy an email account?</strong> Paid email accounts, including Gmail and others when listed, are separate from this free temporary inbox. Availability and checkout depend on the listing.</p>
        <Link href="/dashboard/accounts" className="mt-2 inline-block font-semibold text-lav-700 underline underline-offset-2">Browse email accounts</Link>
      </div>
      <InboxManager />
    </div>
  );
}
