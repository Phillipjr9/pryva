import { NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { isPreviewDatabase } from "@/lib/demo-policy";

export const dynamic = "force-dynamic";

/** Public readiness check. Never expose database errors or private business metrics. */
export async function GET() {
  const preview = isPreviewDatabase();
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: "healthy", mode: preview ? "preview" : "database" }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ status: "unavailable", mode: preview ? "preview" : "database" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
