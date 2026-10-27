import { redirect } from "next/navigation";
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
import { OrderActions } from "@/components/dashboard/OrderActions";

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

export default async function OrderDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("/dashboard/orders");

  // Credentials live on this page: never cache the HTML anywhere.
  await connection();

  const { id } = await params;

  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, id), eq(orders.userId, user.id)),
  });

  if (!order) {
    redirect("/dashboard/orders");
  }

  const credentials = parseAccounts(order.accounts);

  const statusColors = {
    active: "info",
    processing: "info",
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
          <div className="lg:col-span-2 space-y-6">
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
                  <div>
                    <p className="text-[0.82rem] text-ink-3 mb-1">Amount</p>
                    <p className="text-[0.95rem] font-medium text-ink">
                      {formatNaira(order.amount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[0.82rem] text-ink-3 mb-1">Status</p>
                    <Badge variant={statusColors[order.status as keyof typeof statusColors] || "default"}>
                      {order.status}
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

            {order.status === "refunded" && (
              <Card>
                <CardHeader>
                  <CardTitle>Refunded</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-[0.88rem] text-ink-2">
                    {formatNaira(order.amount)} was returned to your wallet automatically. Refunded or
                    replaced credentials are masked by the seller and are no longer usable.
                  </p>
                  {credentials.length > 0 && (
                    <div className="mt-3">
                      <CredentialList accounts={credentials} />
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {order.status === "processing" && credentials.length === 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Delivery in progress</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-[0.88rem] text-ink-2">
                    We&apos;re still waiting on the seller. If nothing arrives, the amount is refunded to
                    your wallet automatically — you don&apos;t need to ask.
                  </p>
                </CardContent>
              </Card>
            )}

          </div>

          <div className="space-y-6">
            <OrderActions
              orderId={order.id}
              status={order.status}
              expiresAt={order.expiresAt ? new Date(order.expiresAt).toISOString() : null}
              amount={order.amount}
              referenceCode={order.referenceCode ?? null}
              otpCode={order.otpCode ?? null}
              service={order.service}
              provider={order.provider ?? null}
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
