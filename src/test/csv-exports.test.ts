import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn(), where: vi.fn(), findMany: vi.fn() }));
vi.mock("@/db", () => ({ db: {
  select: () => ({ from: () => ({ where: mocks.where }) }),
  query: { walletTransactions: { findMany: mocks.findMany } },
} }));
vi.mock("@/lib/auth", () => ({ requireAuthApi: mocks.user }));
vi.mock("@/lib/admin-auth", () => ({ authorizeAdminApi: mocks.admin }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

import * as adminExport from "@/app/api/admin/export/route";
import * as walletExport from "@/app/api/wallet/transactions/export/route";

beforeEach(() => {
  mocks.admin.mockResolvedValue({ user: { id: "admin" }, response: null });
  mocks.user.mockResolvedValue({ id: "user-1" });
  mocks.where.mockResolvedValue([{ id: "u1", name: '=HYPERLINK("evil")', email: "test@example.com", walletBalance: 10, createdAt: new Date("2025-01-01T00:00:00Z") }]);
  mocks.findMany.mockResolvedValue([{ createdAt: new Date("2025-01-01T00:00:00Z"), description: '+SUM(1,2)\n"text"', type: "credit", amount: -7, balanceAfter: 10, reference: "ref" }]);
});

describe("actual CSV export endpoints", () => {
  it("protects admin exports from formula and delimiter injection", async () => {
    const response = await adminExport.GET(new NextRequest("https://pryva.test/api/admin/export?type=users&format=csv"));
    const csv = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(csv).toContain('"\'=HYPERLINK(""evil"")"');
  });

  it("protects wallet exports while preserving numeric negative amounts", async () => {
    const response = await walletExport.GET(new NextRequest("https://pryva.test/api/wallet/transactions/export?format=csv"));
    const csv = await response.text();
    expect(response.status).toBe(200);
    expect(csv).toContain('"\'+SUM(1,2)\n""text"""');
    expect(csv).toContain('"-7"');
    expect(csv).not.toContain('"\'-7"');
  });

  it("rejects unsupported formats and malformed date ranges", async () => {
    expect((await adminExport.GET(new NextRequest("https://pryva.test/api/admin/export?format=xml"))).status).toBe(400);
    expect((await adminExport.GET(new NextRequest("https://pryva.test/api/admin/export?startDate=not-a-date"))).status).toBe(400);
    expect((await walletExport.GET(new NextRequest("https://pryva.test/api/wallet/transactions/export?format=xml"))).status).toBe(400);
  });
});
