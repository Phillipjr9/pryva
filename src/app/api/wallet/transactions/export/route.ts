import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { walletTransactions } from "@/db/schema";
import { and, eq, desc, gte, lte } from "drizzle-orm";
import { requireAuthApi } from "@/lib/auth";
import { csvRows as encodeCsvRows } from "@/lib/csv";
import { parseExportRange } from "@/lib/export-range";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const format = request.nextUrl.searchParams.get("format") || "csv";
    if (format !== "csv" && format !== "json") return NextResponse.json({ error: "Invalid export format" }, { status: 400 });

    // Optional period. Both bounds are whole Lagos days and inclusive; a missing
    // bound means "no bound", which keeps the button working exactly as it did
    // before ranges existed for anyone who never opens the dates.
    const range = parseExportRange(
      request.nextUrl.searchParams.get("startDate"),
      request.nextUrl.searchParams.get("endDate"),
    );
    if (!range.ok) return NextResponse.json({ error: range.error }, { status: 400 });

    const transactions = await db.query.walletTransactions.findMany({
      where: and(
        eq(walletTransactions.userId, user.id),
        range.start ? gte(walletTransactions.createdAt, range.start) : undefined,
        range.end ? lte(walletTransactions.createdAt, range.end) : undefined,
      ),
      orderBy: [desc(walletTransactions.createdAt)],
    });

    // The filename is the only part of an export that survives being downloaded
    // twice into the same folder, so it carries the period.
    const stamp = `${new Date().toISOString().split("T")[0]}${range.label ? `_${range.label}` : ""}`;

    if (format === "json") {
      const data = transactions.map((tx) => ({
        date: tx.createdAt.toISOString(),
        description: tx.description,
        type: tx.type,
        amount: tx.amount,
        balanceAfter: tx.balanceAfter,
        reference: tx.reference,
      }));

      return new NextResponse(JSON.stringify(data, null, 2), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "private, no-store",
          "Content-Disposition": `attachment; filename="transactions-${stamp}.json"`,
        },
      });
    }

    // CSV format
    const csvRows = [
      ["Date", "Description", "Type", "Amount", "Balance After", "Reference"],
      ...transactions.map((tx) => [
        tx.createdAt.toISOString(),
        tx.description,
        tx.type,
        tx.amount,
        tx.balanceAfter,
        tx.reference,
      ]),
    ];

    const csvContent = encodeCsvRows(csvRows);

    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Content-Disposition": `attachment; filename="transactions-${stamp}.csv"`,
      },
    });
  } catch (error) {
    console.error("Export failed:", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
