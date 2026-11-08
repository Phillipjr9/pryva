import Link from "next/link";

import { requireAdmin } from "@/lib/identity/auth";
import { readSupplierHealth } from "@/lib/admin/supplier-health";

export const dynamic = "force-dynamic";

function money(value: number | null): string {
  return value === null ? "—" : `₦${value.toLocaleString("en-NG")}`;
}

export default async function AdminSuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string }>;
}) {
  await requireAdmin("/admin/suppliers");
  const params = await searchParams;
  const report = await readSupplierHealth({ country: params.country });

  const destinationCards = report.destinations;
  const selectedCountry = params.country?.trim().toLowerCase() || null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[1.5rem] font-medium tracking-tight">Supplier health</h1>
          <p className="mt-1 max-w-3xl text-[0.86rem] text-ink-2">
            Read-only supplier checks for the countries we sell. Bitcall is the single-use OTP purchase route; Fleexa remains
            visible for diagnostics and rentals. This highlights missing keys, low balance or a Bitcall offer below our margin floor.
          </p>
        </div>
        <div className="rounded-xl border border-line bg-white px-4 py-2 text-right">
          <p className="text-meta uppercase tracking-wide text-ink-3">Gateway</p>
          <p className="text-[1rem] font-semibold text-ink">{report.gateway.keyEnvironment ?? "not configured"}</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-line bg-white p-4">
          <p className="text-meta uppercase tracking-[0.12em] text-ink-3">Balance</p>
          <p className="mt-1 text-lg font-semibold text-ink">
            {report.gateway.balance?.amount === null ? "—" : `${report.gateway.balance?.amount ?? 0} ${report.gateway.balance?.currency ?? ""}`.trim()}
          </p>
          <p className="mt-1 text-xs text-ink-3">{money(report.gateway.balance?.amountNgn ?? null)}</p>
        </div>
        <div className="rounded-xl border border-line bg-white p-4">
          <p className="text-meta uppercase tracking-[0.12em] text-ink-3">FX rate</p>
          <p className="mt-1 text-lg font-semibold text-ink">{report.usdToNgn ? `₦${report.usdToNgn.rate.toLocaleString("en-NG")}` : "—"}</p>
          <p className="mt-1 text-xs text-ink-3">{report.usdToNgn?.source ?? "No configured rate"}</p>
        </div>
        <div className="rounded-xl border border-line bg-white p-4">
          <p className="text-meta uppercase tracking-[0.12em] text-ink-3">Countries</p>
          <p className="mt-1 text-lg font-semibold text-ink">{destinationCards.length}</p>
          <p className="mt-1 text-xs text-ink-3">{destinationCards.filter((country) => country.sellable).length} sellable now</p>
        </div>
      </div>

      <section className="rounded-2xl border border-line bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[0.8rem] font-semibold uppercase tracking-[0.12em] text-ink-3">Filter</span>
          <Link
            href="/admin/suppliers"
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${selectedCountry ? "bg-cream text-ink" : "bg-lav-50 text-lav-800"}`}
          >
            All countries
          </Link>
          {destinationCards.map((item) => (
            <Link
              key={item.country}
              href={`/admin/suppliers?country=${item.country}`}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${selectedCountry === item.country ? "bg-lav-50 text-lav-800" : "bg-cream text-ink"}`}
            >
              {item.name}
            </Link>
          ))}
        </div>
      </section>

      <div className="space-y-4">
        {destinationCards.map((destination) => (
          <section key={destination.country} className="rounded-2xl border border-line bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-[1.05rem] font-medium text-ink">{destination.name}</h2>
                <p className="text-[0.8rem] text-ink-3">{destination.country.toUpperCase()}</p>
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 text-meta font-semibold ${destination.sellable ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}
              >
                {destination.sellable ? "Sellable" : "No stock"}
              </span>
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[40rem] text-left text-[0.82rem]">
                <thead>
                  <tr className="border-b border-line text-meta uppercase tracking-[0.12em] text-ink-3">
                    <th className="px-3 py-2 font-semibold">Supplier</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 text-right font-semibold">Listed</th>
                    <th className="px-3 py-2 text-right font-semibold">In stock</th>
                    <th className="px-3 py-2 text-right font-semibold">Cheapest</th>
                    <th className="px-3 py-2 font-semibold">Apps</th>
                  </tr>
                </thead>
                <tbody>
                  {destination.suppliers.map((supplier) => (
                    <tr key={supplier.supplier} className="border-b border-line/60 last:border-0">
                      <td className="px-3 py-2.5 font-medium text-ink">{supplier.supplier}</td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[0.72rem] font-semibold ${supplier.configured && !supplier.errorCode ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}
                        >
                          {supplier.errorCode ? supplier.errorCode : supplier.configured ? "Connected" : "Not configured"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right text-ink-2">{supplier.listed}</td>
                      <td className="px-3 py-2.5 text-right text-ink-2">{supplier.inStock}</td>
                      <td className="px-3 py-2.5 text-right text-ink-2">{money(supplier.cheapestNgn)}</td>
                      <td className="px-3 py-2.5 text-ink-2">{supplier.apps?.length ? supplier.apps.join(", ") : "No app labels"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>

      <section className="rounded-2xl border border-line bg-white p-4">
        <h2 className="text-[1.05rem] font-medium text-ink">Margin check</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[42rem] text-left text-[0.82rem]">
            <thead>
              <tr className="border-b border-line text-meta uppercase tracking-[0.12em] text-ink-3">
                <th className="px-3 py-2 font-semibold">Plan</th>
                <th className="px-3 py-2 text-right font-semibold">Our price</th>
                <th className="px-3 py-2 text-right font-semibold">Cheapest cost</th>
                <th className="px-3 py-2 text-right font-semibold">Profit</th>
                <th className="px-3 py-2 text-right font-semibold">Margin</th>
                <th className="px-3 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {report.plans.map((plan) => (
                <tr key={plan.slug} className="border-b border-line/60 last:border-0">
                  <td className="px-3 py-2.5">
                    <span className="font-medium text-ink">{plan.name}</span>
                    <span className="ml-2 text-meta text-ink-3">{plan.country.toUpperCase()}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-ink-2">{money(plan.ourPriceNgn)}</td>
                  <td className="px-3 py-2.5 text-right text-ink-2">{plan.cheapest ? money(plan.cheapest.costNgn) : "—"}</td>
                  <td className="px-3 py-2.5 text-right text-ink-2">{plan.profitNgn === null ? "—" : money(plan.profitNgn)}</td>
                  <td className="px-3 py-2.5 text-right text-ink-2">{plan.marginPct === null ? "—" : `${plan.marginPct}%`}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[0.72rem] font-semibold ${plan.clearsFloor ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}
                    >
                      {plan.clearsFloor ? "Clears floor" : plan.blockedBy ?? "Unprofitable"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
