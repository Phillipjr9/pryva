import { db, hasDatabase } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasDatabase) {
    return Response.json({ ok: true, database: false, mode: "read-only-demo" });
  }

  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 500 });
  }
}
