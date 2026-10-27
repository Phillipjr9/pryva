import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { walletTransactions } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const format = request.nextUrl.searchParams.get("format") || "csv";

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
        tx.amount.toString(),
        tx.balanceAfter.toString(),
        tx.reference,
      ]),
    ];

    const csvContent = csvRows.map((row) => row.map((cell) => `"${cell}"`).join(",")).join("\n");

    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="transactions-${new Date().toISOString().split("T")[0]}.csv"`,
      },
    });
  } catch (error) {
    console.error("Export failed:", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
