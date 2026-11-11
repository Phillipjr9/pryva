import { authorizeAdminApi } from "@/lib/identity/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { orders, users, walletTransactions } from "@/db/schema";
import { asc, gte, lte, and } from "drizzle-orm";
import { logger } from "@/lib/platform/logger";
import { csvRows } from "@/lib/platform/csv";
import { MAX_ADMIN_EXPORT_ROWS, MAX_EXPORT_BYTES } from "@/lib/platform/pagination";

export const dynamic = "force-dynamic";

/*
 * With no dates this route used to read every order, account or ledger row the
 * business has ever had — every column of each, password hashes and delivered
 * codes included — into one request's memory, and then build the whole file as
 * a single string beside it. That works on a young table and gets slower,
 * heavier and finally fatal as the table grows, and nothing warns before the
 * day it stops working.
 *
 * An export is now a bounded read: at most `MAX_ADMIN_EXPORT_ROWS` rows, only
 * the columns the file contains, oldest first so consecutive date ranges join
 * up. A range that holds more is refused with an instruction rather than cut
 * short. See `src/lib/platform/pagination.ts` for the numbers and the reasons.
 */
function tooLarge() {
  return NextResponse.json(
    {
      error:
        `That date range holds more than one export can carry (${MAX_ADMIN_EXPORT_ROWS.toLocaleString("en-US")} rows, or about 4 MB). ` +
        "Narrow startDate and endDate and export it in parts; CSV is the more compact format.",
    },
    { status: 413, headers: { "Cache-Control": "private, no-store" } },
  );
}

// GET /api/admin/export - Export business data for reporting
export async function GET(request: NextRequest) {
  try {
    const access = await authorizeAdminApi(request);
    if (access.response) return access.response;

    const { searchParams } = request.nextUrl;
    const type = searchParams.get("type") || "orders"; // orders, users, transactions
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const format = searchParams.get("format") || "json"; // json, csv

    const start = startDate ? new Date(startDate) : new Date(0);
    const end = endDate ? new Date(endDate) : new Date();
    if ((format !== "csv" && format !== "json") || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) {
      return NextResponse.json({ error: "Invalid export format or date range" }, { status: 400 });
    }

    let data: unknown[] = [];
    let filename = "";

    if (type === "orders") {
      const result = await db
        .select({
          id: orders.id,
          reference: orders.reference,
          userId: orders.userId,
          service: orders.service,
          productName: orders.productName,
          planLabel: orders.planLabel,
          region: orders.region,
          duration: orders.duration,
          amount: orders.amount,
          status: orders.status,
          provider: orders.provider,
          createdAt: orders.createdAt,
          expiresAt: orders.expiresAt,
        })
        .from(orders)
        .where(and(gte(orders.createdAt, start), lte(orders.createdAt, end)))
        .orderBy(asc(orders.createdAt))
        .limit(MAX_ADMIN_EXPORT_ROWS + 1);
      if (result.length > MAX_ADMIN_EXPORT_ROWS) return tooLarge();

      data = result.map((o) => ({
        id: o.id,
        reference: o.reference,
        userId: o.userId,
        service: o.service,
        productName: o.productName,
        planLabel: o.planLabel,
        region: o.region,
        duration: o.duration,
        amount: o.amount,
        status: o.status,
        provider: o.provider,
        createdAt: o.createdAt,
        expiresAt: o.expiresAt,
      }));
      filename = `orders-export-${new Date().toISOString().split("T")[0]}`;
    } else if (type === "users") {
      const result = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          walletBalance: users.walletBalance,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(and(gte(users.createdAt, start), lte(users.createdAt, end)))
        .orderBy(asc(users.createdAt))
        .limit(MAX_ADMIN_EXPORT_ROWS + 1);
      if (result.length > MAX_ADMIN_EXPORT_ROWS) return tooLarge();

      data = result.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        walletBalance: u.walletBalance,
        createdAt: u.createdAt,
      }));
      filename = `users-export-${new Date().toISOString().split("T")[0]}`;
    } else if (type === "transactions") {
      const result = await db
        .select({
          id: walletTransactions.id,
          userId: walletTransactions.userId,
          orderId: walletTransactions.orderId,
          type: walletTransactions.type,
          amount: walletTransactions.amount,
          balanceAfter: walletTransactions.balanceAfter,
          description: walletTransactions.description,
          reference: walletTransactions.reference,
          createdAt: walletTransactions.createdAt,
        })
        .from(walletTransactions)
        .where(
          and(
            gte(walletTransactions.createdAt, start),
            lte(walletTransactions.createdAt, end)
          )
        )
        .orderBy(asc(walletTransactions.createdAt))
        .limit(MAX_ADMIN_EXPORT_ROWS + 1);
      if (result.length > MAX_ADMIN_EXPORT_ROWS) return tooLarge();

      data = result.map((t) => ({
        id: t.id,
        userId: t.userId,
        orderId: t.orderId,
        type: t.type,
        amount: t.amount,
        balanceAfter: t.balanceAfter,
        description: t.description,
        reference: t.reference,
        createdAt: t.createdAt,
      }));
      filename = `transactions-export-${new Date().toISOString().split("T")[0]}`;
    } else {
      return NextResponse.json({ error: "Invalid export type" }, { status: 400 });
    }

    logger.info("Admin data export", { type, count: data.length });

    if (format === "csv") {
      // Convert to CSV
      const csv = convertToCSV(data as Record<string, unknown>[]);
      if (Buffer.byteLength(csv, "utf8") > MAX_EXPORT_BYTES) return tooLarge();
      const blob = new Blob([csv], { type: "text/csv" });

      return new NextResponse(blob, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Cache-Control": "private, no-store",
          "Content-Disposition": `attachment; filename="${filename}.csv"`,
        },
      });
    }

    // Return as JSON
    const jsonString = JSON.stringify(data, null, 2);
    if (Buffer.byteLength(jsonString, "utf8") > MAX_EXPORT_BYTES) return tooLarge();
    const blob = new Blob([jsonString], { type: "application/json" });

    return new NextResponse(blob, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="${filename}.json"`,
      },
    });
  } catch (error) {
    logger.error("Failed to export data", { error });
    return NextResponse.json({ error: "Failed to export data" }, { status: 500 });
  }
}

function convertToCSV(data: Record<string, unknown>[]): string {
  if (data.length === 0) return "";

  const headers = Object.keys(data[0]);
  return csvRows([headers, ...data.map((row) => headers.map((header) => row[header]))]);
}
