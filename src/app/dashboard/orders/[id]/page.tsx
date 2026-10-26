import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, hasDatabase } from "@/db";
import { orders } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatNaira, orderStatusLabel } from "@/lib/catalog";
import { OrderActions } from "@/components/dashboard/OrderActions";
import { ArrowRight, Clock, Globe, Mail, Phone, Receipt, Shield, Sim } from "@/components/icons";

export const metadata: Metadata = { title: "Order details" };
export const dynamic = "force-dynamic";

const serviceMeta = {
  numbers: { label: "Virtual number", icon: Phone, href: "/virtual-numbers#buy" },
  esim: { label: "eSIM data", icon: Sim, href: "/esim#buy" },
  proxies: { label: "Residential proxy", icon: Globe, href: "/proxies#buy" },
  "email-otp": { label: "Temporary inbox", icon: Mail, href: "/email-otp#buy" },
} as const;

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser("/dashboard/orders");
  if (!hasDatabase) notFound();

  const { id } = await params;
  const [order] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.id, id), eq(orders.userId, user.id)))
    .limit(1);

  if (!order) notFound();

  const meta = serviceMeta[order.service as keyof typeof serviceMeta] ?? {
    label: order.service,
    icon: Receipt,
    href: "/pricing",
  };
  const Icon = meta.icon;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2 text-[0.74rem] text-ink-3">
        <Link href="/dashboard/orders" className="hover:text-lav-700">
          Orders
        </Link>
        <span>/</span>
        <span className="font-medium text-ink-2">{order.reference}</span>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4 rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-lav-50 text-lav-700">
            <Icon className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[0.66rem] uppercase tracking-[0.16em] text-ink-3">{meta.label}</p>
            <h1 className="mt-1 text-[1.35rem] font-medium leading-tight">
              {order.productName}
            </h1>
            <p className="text-[0.82rem] text-ink-2">{order.planLabel}</p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[0.7rem]">
              <span className="rounded-full bg-cream-2/70 px-2.5 py-1 text-ink-2">{order.region}</span>
              <span className="rounded-full bg-cream-2/70 px-2.5 py-1 text-ink-2">
                {order.duration}
              </span>
              <span className="rounded-full bg-cream-2/70 px-2.5 py-1 font-mono text-ink-2">
                {order.reference}
              </span>
            </div>
          </div>
        </div>
        <div className="text-right">
          <p className="text-[0.66rem] uppercase tracking-[0.16em] text-ink-3">Paid from wallet</p>
          <p className="mt-1 text-[1.5rem] font-semibold leading-none">{formatNaira(order.amount)}</p>
          <p className="mt-1.5 inline-flex items-center gap-1 text-[0.7rem] text-ink-3">
            <Clock className="h-3 w-3" />{" "}
            {new Date(order.createdAt).toLocaleString("en-NG", {
              day: "numeric",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
        <OrderActions
          orderId={order.id}
          status={order.status}
          expiresAt={order.expiresAt ? order.expiresAt.toISOString() : null}
          amount={order.amount}
          referenceCode={order.referenceCode}
          otpCode={order.otpCode}
          service={order.service}
          provider={order.provider}
        />

        <div className="grid gap-4">
          <div className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
            <h2 className="text-[1rem] font-semibold">Order summary</h2>
            <dl className="mt-3 grid gap-2.5 text-[0.8rem]">
              {[
                { term: "Reference", value: order.reference },
                { term: "Service", value: meta.label },
                { term: "Region", value: order.region },
                { term: "Duration", value: order.duration },
                { term: "Fulfilled by", value: order.provider === "fleexa" ? "Fleexa API · live" : "Preview fulfilment" },
                { term: "Status", value: orderStatusLabel(order.status) },
                {
                  term: "Expires",
                  value: order.expiresAt
                    ? new Date(order.expiresAt).toLocaleString("en-NG", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "No expiry",
                },
              ].map((row) => (
                <div key={row.term} className="flex items-start justify-between gap-3">
                  <dt className="text-ink-3">{row.term}</dt>
                  <dd className="max-w-[60%] text-right font-medium capitalize text-ink">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
            <p className="flex items-start gap-2 text-[0.8rem] leading-relaxed text-ink-2">
              <Shield className="mt-0.5 h-4 w-4 shrink-0 text-lav-600" />
              Keep this page bookmarked — your codes and credentials stay available here, even after
              the delivery window closes.
            </p>
            <Link
              href={meta.href}
              className="mt-3.5 inline-flex items-center gap-1.5 text-[0.78rem] font-semibold text-lav-700 hover:underline"
            >
              Buy another
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
