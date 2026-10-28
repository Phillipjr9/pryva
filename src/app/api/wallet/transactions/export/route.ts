import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { walletTransactions } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuthApi } from "@/lib/auth";
import { csvRows as encodeCsvRows } from "@/lib/csv";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const format = request.nextUrl.searchParams.get("format") || "csv";
    if (format !== "csv" && format !== "json") return NextResponse.json({ error: "Invalid export format" }, { status: 400 });

    const transactions = await db.query.walletTransactions.findMany({
      where: eq(walletTransactions.userId, user.id),
      orderBy: [desc(walletTransactions.createdAt)],
    });

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
          "Content-Disposition": `attachment; filename="transactions-${new Date().toISOString().split("T")[0]}.json"`,
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
        "Content-Disposition": `attachment; filename="transactions-${new Date().toISOString().split("T")[0]}.csv"`,
      },
    });
  } catch (error) {
    console.error("Export failed:", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
