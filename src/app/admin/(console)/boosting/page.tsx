import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "@/components/icons";
import { requireAdmin } from "@/lib/auth";
import { isSmmPanelConfigured, panelEndpoint, SmmPanelError, smmPanelApiKey } from "@/lib/smm-panel";
import { smmMarkupPercent, smmUsdNgnRate } from "@/lib/smm-pricing";
import { boostingReadiness, readinessHeadline, type ReadinessStep } from "@/lib/boosting-readiness";
import { BoostingLiveCheck } from "./BoostingLiveCheck";

export const metadata: Metadata = { title: "Boosting · Admin" };
export const dynamic = "force-dynamic";

/**
 * Everything standing between the shop and a boost purchase, in one place.
 *
 * Boosting is the one product that is invisible until it is fully configured:
 * with no key there is nothing to list, and with a key but no price the listing
 * is a read-only card. Neither state says why, from the storefront. This screen
 * says why, and gives the operator the exact variable to set for each step —
 * never the value of one.
 */
export default async function AdminBoostingPage() {
  await requireAdmin();

  const keySet = isSmmPanelConfigured() ? true : smmPanelApiKey() !== null;

  let endpoint: string | null = null;
  let endpointProblem: string | null = null;
  try {
    endpoint = panelEndpoint();
  } catch (error) {
    endpointProblem =
      error instanceof SmmPanelError
        ? "This address is not a usable supplier endpoint: it must be https, carry no credentials and point outside the network."
        : "This address is not a valid URL.";
    // Keep what was set, so the screen can say "set, but rejected".
    endpoint = process.env.SMM_PANEL_API_URL?.trim() || null;
  }

  const readiness = boostingReadiness({
    keySet,
    endpoint,
    endpointProblem,
    markupPercent: smmMarkupPercent(),
    fxRate: smmUsdNgnRate(),
  });

  return (
    <div className="mx-auto grid max-w-5xl gap-5 px-4 py-6">
      <div>
        <p className="eyebrow">Social promotion</p>
        <h1 className="mt-1.5 text-[1.6rem] font-semibold text-ink">Boosting</h1>
        <p className="mt-1.5 max-w-2xl text-[0.86rem] leading-relaxed text-ink-2">
          Followers, likes, views and subscribers, sold from the wallet and fulfilled by your supplier. This screen
          shows what is configured and what is still missing. It never displays a key.
        </p>
      </div>

      <p
        className={`rounded-2xl border px-4 py-3 text-[0.86rem] leading-relaxed ${
          readiness.configured
            ? "border-emerald-200 bg-emerald-50/70 text-emerald-900"
            : "border-amber-200 bg-amber-50/70 text-amber-900"
        }`}
      >
        {readinessHeadline(readiness)}
      </p>

      <section className="grid gap-2.5">
        {readiness.steps.map((step) => (
          <Step key={step.id} step={step} />
        ))}
      </section>

      <BoostingLiveCheck />

      <section className="rounded-2xl border border-line bg-[#fffdfa] p-5 text-[0.84rem] leading-relaxed text-ink-2">
        <h2 className="text-[1rem] font-semibold text-ink">What happens when a customer buys</h2>
        <ol className="mt-2 grid list-decimal gap-1.5 pl-4">
          <li>The wallet is debited and the order is written in the same transaction, as <code>processing</code>.</li>
          <li>Exactly one order is sent to the supplier — never two, even if the customer retries, because the request key is kept.</li>
          <li>The order is marked <code>active</code> with the supplier&apos;s reference.</li>
          <li>
            If the supplier refuses, the wallet is credited back in full and the order becomes <code>refunded</code>;
            if that refund cannot be written, the debit stays at <code>processing</code> with a note so it can be found.
          </li>
        </ol>
        <p className="mt-3">
          The supplier&apos;s name, its service ids and its wholesale rates never reach a customer surface. Pricing
          rules live in <code>src/lib/smm-pricing.ts</code>; the purchase flow in <code>src/lib/boost-orders.ts</code>.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/dashboard/services?category=social" className="btn btn-ghost !px-4 !py-2.5 !text-[0.8rem]">
            See the storefront <ArrowRight className="h-3.5 w-3.5" />
          </Link>
          <Link href="/admin/orders" className="btn btn-ghost !px-4 !py-2.5 !text-[0.8rem]">
            Boost orders
          </Link>
        </div>
      </section>
    </div>
  );
}

function Step({ step }: { step: ReadinessStep }) {
  const tone =
    step.state === "done"
      ? "border-emerald-200 bg-emerald-50/60"
      : step.state === "blocked"
        ? "border-rose-200 bg-rose-50/60"
        : step.state === "optional"
          ? "border-line bg-white"
          : "border-amber-200 bg-amber-50/60";

  const badge =
    step.state === "done"
      ? { label: "Ready", className: "bg-emerald-100 text-emerald-800" }
      : step.state === "blocked"
        ? { label: "Rejected", className: "bg-rose-100 text-rose-800" }
        : step.state === "optional"
          ? { label: "Optional", className: "bg-cream-3 text-ink-2" }
          : { label: "To do", className: "bg-amber-100 text-amber-900" };

  return (
    <div className={`flex flex-wrap items-start justify-between gap-3 rounded-2xl border px-4 py-3.5 ${tone}`}>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-[0.9rem] font-semibold text-ink">
          {step.label}
          {step.env && (
            <code className="rounded bg-white/70 px-1.5 py-0.5 text-micro font-medium text-ink-3">{step.env}</code>
          )}
        </p>
        <p className="mt-1 text-meta leading-relaxed text-ink-2">{step.detail}</p>
      </div>
      <span className={`rounded-full px-2.5 py-1 text-micro font-semibold ${badge.className}`}>{badge.label}</span>
    </div>
  );
}
