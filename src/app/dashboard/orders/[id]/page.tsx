import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatNaira } from "@/lib/catalog";
import Link from "next/link";
import { ArrowLeft } from "@/components/icons";

export default async function OrderDetailsPage({ params }: { params: { id: string } }) {
  const user = await requireAuth();
  if (!user) redirect("/login?next=/dashboard/orders");

  const order = await db.query.orders.findFirst({
    where: and(eq(orders.id, params.id), eq(orders.userId, user.id)),
  });

  if (!order) {
    redirect("/dashboard/orders");
  }

  const statusColors = {
    active: "info",
    delivered: "success",
    refunded: "warning",
    expired: "error",
  } as const;

  return (
    <DashboardShell user={user}>
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link
            href="/dashboard/orders"
            className="grid h-10 w-10 place-items-center rounded-full border border-line bg-white text-ink hover:bg-cream"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-[1.75rem] font-medium tracking-tight text-ink">
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

            {order.referenceCode && (
              <Card>
                <CardHeader>
                  <CardTitle>Service Details</CardTitle>
                </CardHeader>
                <CardContent>
                  <div>
                    <p className="text-[0.82rem] text-ink-3 mb-2">Reference Code</p>
                    <p className="text-[1.1rem] font-mono font-semibold text-ink">
                      {order.referenceCode}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}

            {order.otpCode && (
              <Card>
                <CardHeader>
                  <CardTitle>OTP Code</CardTitle>
                </CardHeader>
                <CardContent>
                  <div>
                    <p className="text-[0.82rem] text-ink-3 mb-2">Verification Code</p>
                    <p className="text-[2rem] font-mono font-bold text-lav-600">
                      {order.otpCode}
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-6">
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
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
