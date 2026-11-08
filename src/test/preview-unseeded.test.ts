import { afterAll, describe, expect, it, vi } from "vitest";

describe("an unconfigured preview database", () => {
  afterAll(() => vi.unstubAllEnvs());

  it("seeds a demo sign-in and a live code for localhost review", async () => {
    for (const name of ["DATABASE_URL", "PGHOST", "PGUSER", "AWS_REGION", "AWS_ROLE_ARN"]) vi.stubEnv(name, "");
    const { readPreviewDatabase } = await import("@/db");
    const snapshot = readPreviewDatabase((data) => data);

    expect(snapshot.users.some((row) => String(row.email).toLowerCase() === "demo@pryva.test")).toBe(true);
    expect(snapshot.orders.some((row) => row.service === "numbers" && row.status === "active" && row.otpCode)).toBe(true);
    expect(snapshot.walletTransactions.length).toBeGreaterThan(0);
  });
});
