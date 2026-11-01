import { notFound } from "next/navigation";
import { connection } from "next/server";
import { requireUser } from "@/lib/auth";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatNaira } from "@/lib/catalog";
import Link from "next/link";
import { ArrowLeft } from "@/components/icons";
import { CredentialList } from "./CredentialList";
import { EsimProfile } from "./EsimProfile";
import { OrderActions } from "@/components/dashboard/OrderActions";
import { pollsForCode } from "@/lib/order-providers";
import { canResendNumberCode } from "@/lib/otp-resend";
import { syncBoostOrderStatus, type BoostSyncResult } from "@/lib/boost-status";
import { esimQrDataUrl } from "@/lib/esim-qr";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function parseAccounts(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    // A single credential string, or something written before the JSON column.
    return raw.trim() ? [raw] : [];
  }
}

/**
 * One line of delivery progress, in the customer's language.
 *
 * The panel speaks in `remains`; a person wants "340 of 1,000 delivered". Nothing
 * here names where the units come from -- that is a sourcing detail and it has no
 * place on a customer's receipt.
 */
function progressLine(sync: BoostSyncResult, quantity: number | null): string | null {
  if (!sync.synced) return null;
  if (sync.remains !== null && quantity && quantity > 0) {
    const delivered = Math.max(0, quantity - sync.remains);
    return `${delivered.toLocaleString("en-NG")} of ${quantity.toLocaleString("en-NG")} delivered so far.`;
  }
  if (sync.reportedState === "pending") return "Queued — delivery has not started yet.";
  if (sync.reportedState === "in_progress") return "Delivery is under way.";
  return null;
}

export default async function OrderDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("/dashboard/orders");

  // Credentials live on this page: never cache the HTML anywhere.
  await connection();

  const { id } = await params;

  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.userId, user.id)),
  });

  if (!order) {
    // A wrong or stale order link used to bounce silently to the order list,
    // which looked like the order had vanished. Say so instead: the global 404
    // already offers a way back to the dashboard.
    notFound();
  }

  // Ask the delivery side how far this order has got, for boosts only. Best
  // effort: an unreachable panel leaves the stored status in place rather than
  // failing the order page.
  const boostSync = await syncBoostOrderStatus(order);
  const status = boostSync.status ?? order.status;

  const credentials = parseAccounts(order.accounts);
  // Share the request-time clock with the client for hydration-safe countdowns.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const progress = progressLine(boostSync, order.quantity ?? null);

  const statusColors = {
    active: "info",
    processing: "info",
    review: "warning",
    delivered: "success",
    refunded: "warning",
    expired: "error",
  } as const;

  return (
    <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard/orders"
            className="grid h-10 w-10 place-items-center rounded-full border border-line bg-white text-ink hover:bg-cream"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-[1.5rem] font-medium tracking-tight text-ink sm:text-[1.7rem]">
              Order Details
            </h1>
            <p className="text-[0.9rem] text-ink-2">{order.reference}</p>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="order-2 space-y-6 lg:order-1 lg:col-span-2">
            {order.service === "esim" ? (
              <Card>
                <CardHeader>
                  <CardTitle>Your eSIM</CardTitle>
                </CardHeader>
                <CardContent>
                  <EsimProfile
                    orderId={order.id}
                    qrDataUrl={
                      order.esimActivationCode && status !== "processing"
                        ? await esimQrDataUrl(order.esimActivationCode)
                        : null
                    }
                    activationCode={order.esimActivationCode}
                    installUrl={order.esimInstallUrl}
                    iccid={order.esimIccid}
                    pending={status === "processing"}
                  />
                </CardContent>
              </Card>
            ) : null}
            <Card>
              <CardHeader>
                <CardTitle>Order Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-[0.82rem] text-ink-3 mb-1">Product</p>
                    <p className="text-[0.95rem] font-medium text-ink">
                      {order.productName}
                    </p>
                  </div>
                  <div>
                    <p className="text-[0.82rem] text-ink-3 mb-1">Service</p>
                    <p className="text-[0.95rem] font-medium text-ink capitalize">
                      {order.service}
                    </p>
                  </div>
                  <div>
                    <p className="text-[0.82rem] text-ink-3 mb-1">Plan / package</p>
                    <p className="text-[0.95rem] font-medium text-ink">{order.planLabel}</p>
                  </div>
                  <div>
                    <p className="text-[0.82rem] text-ink-3 mb-1">Region</p>
                    <p className="text-[0.95rem] font-medium text-ink">
                      {order.region}
                    </p>
                  </div>
                  <div>
                    <p className="text-[0.82rem] text-ink-3 mb-1">Duration</p>
                    <p className="text-[0.95rem] font-medium text-ink">
                      {order.duration}
                    </p>
                  </div>
                  {order.targetLink && (
                    <div className="sm:col-span-2">
                      <p className="text-[0.82rem] text-ink-3 mb-1">Boosted link</p>
                      <a
                        href={order.targetLink}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="break-all text-[0.9rem] font-medium text-lav-700 underline underline-offset-2"
                      >
                        {order.targetLink}
                      </a>
                      {order.quantity ? <span className="ml-2 text-meta text-ink-3">· {order.quantity.toLocaleString("en-NG")} units</span> : null}
                    </div>
                  )}
                  <div>
                    <p className="text-[0.82rem] text-ink-3 mb-1">Amount</p>
                    <p className="text-[0.95rem] font-medium text-ink">
                      {formatNaira(order.amount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[0.82rem] text-ink-3 mb-1">Status</p>
                    <Badge variant={statusColors[status as keyof typeof statusColors] || "default"}>
                      {status}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            {credentials.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Account credentials ({credentials.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <CredentialList accounts={credentials} />
                </CardContent>
              </Card>
            )}

            {status === "refunded" && (
              <Card>
                <CardHeader>
                  <CardTitle>Refunded</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-[0.88rem] text-ink-2">
                    {formatNaira(order.amount)} was returned to your wallet.
                  </p>
                  {credentials.length > 0 && (
                    <div className="mt-3">
                      <CredentialList accounts={credentials} />
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {(status === "processing" || status === "review" || status === "active") && (
              <Card>
                <CardHeader>
                  <CardTitle>{status === "review" ? "Order needs review" : "Delivery in progress"}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-[0.88rem] text-ink-2">
                    Delivery has not been confirmed. Please don&apos;t place this order again; contact support
                    with your reference if you need help. Refunds require verification.
                  </p>
                  {progress && <p className="mt-2 text-[0.88rem] font-medium text-ink">{progress}</p>}
                </CardContent>
              </Card>
            )}

          </div>

          <div className="order-1 space-y-6 lg:order-2">
            <OrderActions
              key={order.id}
              orderId={order.id}
              status={status}
              expiresAt={order.expiresAt ? new Date(order.expiresAt).toISOString() : null}
              amount={order.amount}
              referenceCode={order.referenceCode ?? null}
              otpCode={order.otpCode ?? null}
              service={order.service}
              refreshableCode={pollsForCode(order)}
              // Decided on the server: the browser gets a boolean, never a name.
              canResendCode={canResendNumberCode(order)}
              initialNow={now}
            />
            <Card>
              <CardHeader>
                <CardTitle>Timeline</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-[0.82rem] text-ink-3 mb-1">Created</p>
                  <p className="text-[0.9rem] text-ink">
                    {new Date(order.createdAt).toLocaleString()}
                  </p>
                </div>
                {order.expiresAt && (
                  <div>
                    <p className="text-[0.82rem] text-ink-3 mb-1">Expires</p>
                    <p className="text-[0.9rem] text-ink">
                      {new Date(order.expiresAt).toLocaleString()}
                    </p>
                  </div>
                )}
                {order.refundedAt && (
                  <div>
                    <p className="text-[0.82rem] text-ink-3 mb-1">Refunded</p>
                    <p className="text-[0.9rem] text-ink">
                      {new Date(order.refundedAt).toLocaleString()}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
    </div>
  );
}
