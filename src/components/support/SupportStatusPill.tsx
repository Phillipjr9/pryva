import { SUPPORT_STATUS_LABELS, isSupportStatus } from "@/lib/ai-support/types";

/**
 * One status, one colour, everywhere.
 *
 * The dashboard and the admin queue show the same words for the same state on
 * purpose: "escalated" means "a person has it" in both, and a customer reading
 * their own thread should not have to translate a support-internal vocabulary.
 */
const STYLES: Record<string, string> = {
  open: "bg-lav-100 text-lav-800",
  waiting_on_customer: "bg-amber-50 text-amber-800",
  escalated: "bg-rose-50 text-rose-700",
  resolved: "bg-emerald-50 text-emerald-700",
  closed: "bg-slate-100 text-slate-600",
};

export function SupportStatusPill({ status }: { status: string }) {
  const known = isSupportStatus(status);
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-micro font-semibold ${STYLES[known ? status : "open"] ?? STYLES.open}`}
    >
      {known ? SUPPORT_STATUS_LABELS[status] : status}
    </span>
  );
}
