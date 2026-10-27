import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { db } from "@/db";
import { orders, users, walletTransactions } from "@/db/schema";
import { gte, lte, and } from "drizzle-orm";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

// GET /api/admin/export - Export business data for reporting
export async function GET(request: NextRequest) {
    const admin = await requireAdminApi();
    if (!admin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  try {
    const { searchParams } = request.nextUrl;
    const type = searchParams.get("type") || "orders"; // orders, users, transactions
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const format = searchParams.get("format") || "json"; // json, csv

    const start = startDate ? new Date(startDate) : new Date(0);
    const end = endDate ? new Date(endDate) : new Date();

    let data: unknown[] = [];
    let filename = "";

    if (type === "orders") {
      const result = await db
        .select()
        .from(orders)
        .where(and(gte(orders.createdAt, start), lte(orders.createdAt, end)));

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
        .select()
        .from(users)
        .where(and(gte(users.createdAt, start), lte(users.createdAt, end)));

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
        .select()
        .from(walletTransactions)
        .where(
          and(
            gte(walletTransactions.createdAt, start),
            lte(walletTransactions.createdAt, end)
          )
        );

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
      const blob = new Blob([csv], { type: "text/csv" });

      return new NextResponse(blob, {
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="${filename}.csv"`,
        },
      });
    }

    // Return as JSON
    const jsonString = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonString], { type: "application/json" });

    return new NextResponse(blob, {
      headers: {
        "Content-Type": "application/json",
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
  const csvHeaders = headers.join(",");

  const csvRows = data.map((row) => {
    return headers
      .map((header) => {
        const value = row[header];
        // Escape quotes and wrap in quotes if contains comma or newline
        const stringValue = String(value ?? "");
        if (stringValue.includes(",") || stringValue.includes("\n") || stringValue.includes('"')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      })
      .join(",");
  });

  return [csvHeaders, ...csvRows].join("\n");
}
