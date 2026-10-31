import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { adminAuditLog } from "@/db/schema";
import { recordAdminAction } from "@/lib/admin-audit";

/**
 * The audit trail is a record, not the money ledger, and the two failure modes
 * that matter are opposite:
 *
 *   * it must actually write, or "who refunded this?" is unanswerable;
 *   * it must never throw, because it runs after money has already moved — a
 *     failed audit insert must not turn a committed refund into a reported
 *     failure that an operator then retries.
 *
 * These tests pin both. `DATABASE_URL` is unset in the test environment, so `db`
 * is the in-memory preview database.
 */

const admin = { id: "e6601368-4eef-45e7-a562-f8621c4239f2", email: "owner@pryva.ng" };

describe("recordAdminAction", () => {
  it("writes a durable entry with the actor's email snapshotted", async () => {
    const written = await recordAdminAction({
      actor: admin,
      action: "order.refund",
      targetType: "order",
      targetId: "audit-order-1",
      summary: "Refunded ₦1,500 for PV-AUDIT1 (Virtual number) — supplier never delivered",
    });
    expect(written).toBe(true);

    const rows = await db.select().from(adminAuditLog);
    const entry = rows.find((row) => row.targetId === "audit-order-1");
    expect(entry).toBeDefined();
    expect(entry?.actorEmail).toBe("owner@pryva.ng");
    expect(entry?.action).toBe("order.refund");
    expect(entry?.targetType).toBe("order");
    expect(entry?.summary).toContain("PV-AUDIT1");
  });

  it("returns false instead of throwing when the insert fails", async () => {
    // Force the failure a database outage would produce. The action that called
    // this has already committed by now, so throwing here would be a lie.
    const spy = vi.spyOn(db, "insert").mockImplementation(() => {
      throw new Error("database unavailable");
    });

    const written = await recordAdminAction({
      actor: admin,
      action: "withdrawal.approve",
      targetType: "withdrawal",
      targetId: "audit-withdrawal-1",
      summary: "Initiated a ₦5,000 transfer for WD-1",
    });

    expect(written).toBe(false);
    spy.mockRestore();

    const rows = await db.select().from(adminAuditLog);
    expect(rows.some((row) => row.targetId === "audit-withdrawal-1")).toBe(false);
  });

  it("bounds the target id and summary so one long value cannot break the column", async () => {
    const written = await recordAdminAction({
      actor: admin,
      action: "message.status",
      targetType: "message",
      targetId: "x".repeat(400),
      summary: "y".repeat(5_000),
    });
    expect(written).toBe(true);

    const rows = await db.select().from(adminAuditLog);
    const entry = rows.find((row) => row.targetType === "message" && row.targetId.startsWith("xxx"));
    expect(entry).toBeDefined();
    expect(entry?.targetId).toHaveLength(191);
    expect(entry?.summary).toHaveLength(2_000);
  });
});

/**
 * A static guard against silent regressions: if a privileged route is refactored
 * and loses its audit call, every behavioural test can still pass while the
 * record quietly stops being written. The money routes are the ones that matter.
 */
describe("privileged routes record an audit entry", () => {
  const routes = [
    "src/app/api/admin/refunds/route.ts",
    "src/app/api/admin/withdrawals/route.ts",
    "src/app/api/admin/fulfilment/route.ts",
    "src/app/api/admin/users/[id]/route.ts",
    "src/app/api/admin/messages/route.ts",
  ];

  it.each(routes)("%s calls recordAdminAction", (route) => {
    const source = readFileSync(join(process.cwd(), route), "utf8");
    expect(source).toContain("recordAdminAction(");
  });

  it("never copies delivered credentials into the audit summary", () => {
    const source = readFileSync(join(process.cwd(), "src/app/api/admin/fulfilment/route.ts"), "utf8");
    const call = source.slice(source.indexOf('action: "order.deliver"'));
    const summary = call.slice(call.indexOf("summary:"), call.indexOf("});"));
    // The count is recorded; the credential strings themselves must not be.
    expect(summary).toContain("credentials.length");
    expect(summary).not.toMatch(/credentials\s*[,\[]/);
  });
});
