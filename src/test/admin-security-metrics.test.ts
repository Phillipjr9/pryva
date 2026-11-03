import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { SECURITY_VIOLATION_TYPES } from "@/lib/security-violation-types";

/**
 * The reader of `security_violations`.
 *
 * The admin dashboard is the owner's only view of this table, and it is built from
 * the numbers this route returns. A type the route does not ask about is invisible:
 * the row exists and the total counts it, but no tile moves -- which reads as
 * "nothing of that kind happened" rather than as a page that cannot see it.
 *
 * These tests seed one row per type the writer can store and check that all six
 * come back.
 */

const dialect = new PgDialect();
const mocks = vi.hoisted(() => ({ authorizeAdminApi: vi.fn() }));
const state = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, asked: [] as string[] }));

vi.mock("@/lib/admin-auth", () => ({ authorizeAdminApi: mocks.authorizeAdminApi }));

function projectionCount(projection: Record<string, unknown> | undefined, type: string | undefined) {
  const matching = type === undefined ? state.rows : state.rows.filter((row) => row.type === type);
  if (projection && "count" in projection) return [{ count: matching.length }];
  return matching;
}

vi.mock("@/db", () => ({
  db: {
    select: (projection?: Record<string, unknown>) => ({
      from: () => {
        const query: Record<string, unknown> = {};
        let type: string | undefined;
        query.where = (condition: SQL) => {
          type = dialect.sqlToQuery(condition).params[0] as string;
          state.asked.push(type);
          return query;
        };
        for (const method of ["orderBy", "limit"]) query[method] = () => query;
        query.then = (resolve: (value: unknown) => unknown) =>
          Promise.resolve(projectionCount(projection, type)).then(resolve);
        return query;
      },
    }),
  },
}));

import { GET } from "@/app/api/admin/security/metrics/route";

function request() {
  return new NextRequest("https://pryva.test/api/admin/security/metrics", {
    headers: { host: "pryva.test", "x-forwarded-proto": "https" },
  });
}

async function metrics() {
  return (await (await GET(request())).json()).metrics as {
    totalViolations: number;
    byType: Record<string, number>;
  };
}

beforeEach(() => {
  mocks.authorizeAdminApi.mockResolvedValue({ user: { id: "admin-1" }, response: null });
  state.asked = [];
  state.rows = SECURITY_VIOLATION_TYPES.map((entry, index) => ({
    id: `violation-${index}`,
    userId: "user-1",
    userEmail: "someone@example.com",
    type: entry.type,
    details: entry.label,
    ip: null,
    url: "/dashboard",
    userAgent: "Mozilla/5.0",
    createdAt: new Date("2026-10-31T12:00:00Z"),
  }));
});

describe("the security metrics route", () => {
  /**
   * Independent of what the response is called: the route must ask the database
   * about every type, because a type it never asks about is a type it cannot show.
   */
  it("asks about every violation type the writer can store", async () => {
    await metrics();
    const missing = SECURITY_VIOLATION_TYPES.filter((spec) => !state.asked.includes(spec.type));
    expect(missing.map((spec) => spec.type)).toEqual([]);
  });

  it("reports every violation type it can be given, not the ones it remembers", async () => {
    const body = await metrics();
    expect(Object.keys(body.byType).sort()).toEqual(
      [...SECURITY_VIOLATION_TYPES.map((entry) => entry.type)].sort(),
    );
  });

  it("has tile counts that add up to the total shown beside them", async () => {
    const body = await metrics();
    const summed = Object.values(body.byType).reduce((total, count) => total + count, 0);
    expect(body.totalViolations).toBe(SECURITY_VIOLATION_TYPES.length);
    expect(summed).toBe(body.totalViolations);
  });

  it("counts the modified-environment report, the one a patched detector sends", async () => {
    const body = await metrics();
    expect(body.byType).toMatchObject({ modified_environment: 1 });
  });
});
