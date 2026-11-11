import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { walletTransactions } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuthApi } from "@/lib/identity/auth";
import { csvRows as encodeCsvRows } from "@/lib/platform/csv";
import { MAX_CUSTOMER_EXPORT_ROWS, MAX_EXPORT_BYTES } from "@/lib/platform/pagination";
import { rateLimitRefusal, userExportRateLimiter } from "@/lib/platform/rate-limit";

export const dynamic = "force-dynamic";

/*
 * A customer's whole ledger in one file. It had no row limit and no budget, so
 * its cost was set entirely by the caller: an account with a long history and a
 * loop could keep the database reading and the application serialising for as
 * long as it liked, without touching a money path or any limiter.
 *
 * It now has the budget `/api/user/export` has — two a minute for each account,
 * counted on its own so one export does not spend the other's — reads only the
 * columns the file contains, and refuses a history too long for one download,
 * as that route always has, instead of returning part of it. A ledger that
 * silently stops is worse than one that says to ask support.
 */
function tooLarge() {
  return NextResponse.json(
    { error: "This export is too large. Contact support for your complete transaction history." },
    { status: 413, headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const format = request.nextUrl.searchParams.get("format") || "csv";
    if (format !== "csv" && format !== "json") return NextResponse.json({ error: "Invalid export format" }, { status: 400 });

    const throttle = await userExportRateLimiter(`wallet-export:${user.id}`);
    const refused = rateLimitRefusal(throttle, "You are exporting too quickly. Please wait a minute and try again.");
    if (refused) return refused;

    const transactions = await db.query.walletTransactions.findMany({
      columns: { createdAt: true, description: true, type: true, amount: true, balanceAfter: true, reference: true },
      where: eq(walletTransactions.userId, user.id),
      orderBy: [desc(walletTransactions.createdAt)],
      limit: MAX_CUSTOMER_EXPORT_ROWS + 1,
    });
    if (transactions.length > MAX_CUSTOMER_EXPORT_ROWS) return tooLarge();

    if (format === "json") {
      const data = transactions.map((tx) => ({
        date: tx.createdAt.toISOString(),
        description: tx.description,
        type: tx.type,
        amount: tx.amount,
        balanceAfter: tx.balanceAfter,
        reference: tx.reference,
      }));

      const jsonString = JSON.stringify(data, null, 2);
      if (Buffer.byteLength(jsonString, "utf8") > MAX_EXPORT_BYTES) return tooLarge();

      return new NextResponse(jsonString, {
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
    if (Buffer.byteLength(csvContent, "utf8") > MAX_EXPORT_BYTES) return tooLarge();

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
