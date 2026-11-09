import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as schema from "@/db/schema";

const state = vi.hoisted(() => ({ db: null as unknown, notice: vi.fn(), admin: null as unknown }));
vi.mock("@/db", () => ({ get db() { return state.db; } }));
vi.mock("@/lib/identity/admin-auth", () => ({ authorizeAdminApi: async () => ({ user: state.admin, response: null }) }));
vi.mock("@/lib/email/admin-ban-email", () => ({ scheduleAdminBanEmail: state.notice }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: vi.fn(), get: () => undefined }),
  headers: async () => new Headers({ host: "pryva.test", "x-forwarded-proto": "https" }),
}));

const ADMIN = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
let post: typeof import("@/app/api/admin/users/[id]/ban/route").POST;
let del: typeof import("@/app/api/admin/users/[id]/ban/route").DELETE;
let createSession: typeof import("@/lib/identity/auth").createSession;

beforeAll(async () => {
  vi.stubEnv("ADMIN_EMAILS", "operator@example.com");
  pg = new PGlite();
  for (const file of (await readdir("migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  }
  database = drizzle(pg, { schema });
  state.db = database;
  const now = new Date();
  await database.insert(schema.users).values([
    { id: ADMIN, name: "Admin", email: "operator@example.com", passwordHash: "x", emailVerifiedAt: now },
    { id: USER, name: "Customer", email: "customer@example.com", passwordHash: "y", walletBalance: 9000, emailVerifiedAt: now },
  ]);
  state.admin = { id: ADMIN, email: "operator@example.com", name: "Admin", emailVerifiedAt: now, walletBalance: 0, createdAt: now };
  ({ POST: post, DELETE: del } = await import("@/app/api/admin/users/[id]/ban/route"));
  ({ createSession } = await import("@/lib/identity/auth"));
});
afterAll(async () => { vi.unstubAllEnvs(); await pg?.close(); });

function request(method: string) {
  return new NextRequest("https://pryva.test/api/admin/users/x/ban", { method,
    headers: { host: "pryva.test", "x-forwarded-proto": "https", origin: "https://pryva.test", "content-type": "application/json" },
    body: JSON.stringify({ reason: "Review" }) });
}
const params = { params: Promise.resolve({ id: USER }) };

describe("operator suspension", () => {
  it("revokes sessions, pauses schedules, keeps funds, and records an atomic audit", async () => {
    await database.insert(schema.sessions).values({ userId: USER, token: "existing", expiresAt: new Date(Date.now() + 60000) });
    await database.insert(schema.scheduledOrders).values({ userId: USER, service: "numbers", productSlug: "vn-ng", frequency: "daily", nextRunAt: new Date() });
    const response = await post(request("POST"), params);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, suspended: true });
    const [user] = await database.select().from(schema.users).where(eq(schema.users.id, USER));
    expect(user.suspendedAt).toBeTruthy();
    expect(user.deletedAt).toBeNull();
    expect(user.walletBalance).toBe(9000);
    expect(await database.select().from(schema.sessions).where(eq(schema.sessions.userId, USER))).toHaveLength(0);
    const [schedule] = await database.select().from(schema.scheduledOrders).where(eq(schema.scheduledOrders.userId, USER));
    expect(schedule.status).toBe("paused");
    const audit = await database.select().from(schema.adminAuditLog).where(eq(schema.adminAuditLog.targetId, USER));
    expect(audit.map((row) => row.action)).toContain("user.ban");
    expect(state.notice).toHaveBeenCalledOnce();
    await expect(createSession(USER)).rejects.toThrow("Account unavailable");
  });

  it("does not accidentally restart schedules when reinstated", async () => {
    expect((await del(request("DELETE"), params)).status).toBe(200);
    const [user] = await database.select().from(schema.users).where(eq(schema.users.id, USER));
    expect(user.suspendedAt).toBeNull();
    const [schedule] = await database.select().from(schema.scheduledOrders).where(eq(schema.scheduledOrders.userId, USER));
    expect(schedule.status).toBe("paused");
    await expect(createSession(USER)).resolves.toEqual(expect.any(String));
  });

  it("rolls back the status, session revocation and schedule pause if audit insertion fails", async () => {
    await database.update(schema.scheduledOrders).set({ status: "active" }).where(eq(schema.scheduledOrders.userId, USER));
    await database.insert(schema.sessions).values({ userId: USER, token: "rollback-check", expiresAt: new Date(Date.now() + 60000) });
    await pg.exec(`CREATE FUNCTION reject_ban_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'user.ban' THEN RAISE EXCEPTION 'audit unavailable'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_ban_audit BEFORE INSERT ON admin_audit_log FOR EACH ROW EXECUTE FUNCTION reject_ban_audit();`);
    try {
      expect((await post(request("POST"), params)).status).toBe(500);
      const [user] = await database.select().from(schema.users).where(eq(schema.users.id, USER));
      expect(user.suspendedAt).toBeNull();
      expect(await database.select().from(schema.sessions).where(eq(schema.sessions.token, "rollback-check"))).toHaveLength(1);
      const [schedule] = await database.select().from(schema.scheduledOrders).where(eq(schema.scheduledOrders.userId, USER));
      expect(schedule.status).toBe("active");
    } finally {
      await pg.exec("DROP TRIGGER reject_ban_audit ON admin_audit_log; DROP FUNCTION reject_ban_audit();");
    }
  });

  it("refuses an administrator suspending themselves", async () => {
    expect((await post(request("POST"), { params: Promise.resolve({ id: ADMIN }) })).status).toBe(403);
  });
});
