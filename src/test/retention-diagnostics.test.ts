import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The retention read-out.
 *
 * Two properties matter. It is **read-only** — no request to it can purge a row,
 * and the route does not import the sweep at all — and it is honest about the
 * disarm: when accounts are due but `RETENTION_PURGE_ENABLED` is not set, the
 * verdict says so instead of implying the data is gone.
 */

const state = vi.hoisted(() => ({
  authorized: true,
  preview: false,
  armed: false,
  due: 0,
  closed: 0,
  receipts: 0,
  throws: false,
}));

vi.mock("@/lib/diagnostics-auth", () => ({ diagnosticsAuthorized: () => state.authorized }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/demo-policy", () => ({ isPreviewDatabase: () => state.preview }));
vi.mock("@/lib/retention", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/retention")>();
  return {
    ...actual,
    purgeEnabled: () => state.armed,
    countDueForPurge: async () => {
      if (state.throws) throw new Error("database down");
      return state.due;
    },
  };
});
vi.mock("@/db", () => ({
  db: {
    // `.from(...)` is awaited directly for the receipt count, and `.where(...)`
    // for the closed-account count, so the builder has to support both.
    select: () => ({
      from: () => {
        const direct = Promise.resolve([{ total: state.receipts }]);
        return {
          where: async () => [{ total: state.closed }],
          then: (resolve: (rows: { total: number }[]) => unknown, reject: (e: unknown) => unknown) =>
            direct.then(resolve, reject),
        };
      },
    }),
  },
}));

const { GET } = await import("@/app/api/diagnostics/retention/route");

const request = () => new NextRequest("https://pryva.test/api/diagnostics/retention", { headers: { authorization: "Bearer test" } });

beforeEach(() => {
  state.authorized = true;
  state.preview = false;
  state.armed = false;
  state.due = 0;
  state.closed = 0;
  state.receipts = 0;
  state.throws = false;
});

describe("the retention read-out", () => {
  it("refuses an unauthenticated caller", async () => {
    state.authorized = false;
    expect((await GET(request())).status).toBe(401);
  });

  it("says preview on a deployment with no database", async () => {
    state.preview = true;
    const body = await (await GET(request())).json();
    expect(body.verdict).toBe("preview");
  });

  it("reports current when nothing has reached the horizon", async () => {
    state.closed = 3;
    state.receipts = 3;
    const body = await (await GET(request())).json();
    expect(body).toMatchObject({ verdict: "current", dueForPurge: 0, closedAccounts: 3, closures: 3, armed: false });
    expect(body.retentionYears).toBe(10);
    expect(body.cutoff).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("names the disarm when accounts are due and the sweep is off", async () => {
    state.due = 4;
    state.closed = 9;
    const body = await (await GET(request())).json();
    expect(body.verdict).toBe("armed_off_with_due");
    expect(body.explanation).toContain("RETENTION_PURGE_ENABLED=true");
    expect(body.dueForPurge).toBe(4);
  });

  it("reports purging when the sweep is armed", async () => {
    state.due = 2;
    state.armed = true;
    const body = await (await GET(request())).json();
    expect(body).toMatchObject({ verdict: "purging", armed: true, dueForPurge: 2 });
  });

  it("does not fail when the database cannot be read", async () => {
    state.throws = true;
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect((await response.json()).verdict).toBe("unreachable");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("cannot purge: the route never imports the sweep", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/app/api/diagnostics/retention/route.ts", "utf8"),
    );
    expect(source).not.toContain("purgeExpiredClosedAccounts");
    expect(source).not.toContain("delete(");
  });
});
