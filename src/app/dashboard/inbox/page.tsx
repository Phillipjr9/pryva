import { InboxManager } from "./InboxManager";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Temporary inbox · Pryva",
};

export default async function InboxPage() {
  await requireUser("/dashboard/inbox");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.5rem] font-medium tracking-tight text-ink sm:text-[1.7rem]">Temporary inbox</h1>
        <p className="mt-1 max-w-xl text-[0.86rem] leading-relaxed text-ink-2">
          A free inbox for reading one verification code. Create it, use the address, and discard it
          when you are done — nothing is stored afterwards.
        </p>
      </div>
      <InboxManager />
    </div>
  );
}
