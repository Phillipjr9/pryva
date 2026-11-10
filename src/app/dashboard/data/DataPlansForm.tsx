import type { PublicUser } from "@/lib/identity/auth";

interface DataPlansFormProps {
  user: PublicUser;
  initialPlanId?: string;
}

/** Do not present static, unverified data prices as a live offer. */
export function DataPlansForm(_props: DataPlansFormProps) {
  return (
    <div role="status" className="rounded-xl border border-line bg-white p-6 text-[0.875rem] leading-relaxed text-ink-2">
      Data plans are not available yet. Current plans and prices will be shown when delivery is connected.
    </div>
  );
}
