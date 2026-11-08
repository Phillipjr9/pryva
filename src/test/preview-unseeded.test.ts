import { afterAll, describe, expect, it, vi } from "vitest";

describe("an unconfigured preview database", () => {
  afterAll(() => vi.unstubAllEnvs());

  it("does not seed a demo account or live order for localhost review", async () => {
    for (const name of ["DATABASE_URL", "PGHOST", "PGUSER", "AWS_REGION", "AWS_ROLE_ARN"]) vi.stubEnv(name, "");
    const { readPreviewDatabase } = await import("@/db");
    const snapshot = readPreviewDatabase((data) => data);

    expect(snapshot.users.some((row) => String(row.email).toLowerCase() === "demo@pryva.test")).toBe(false);
    expect(snapshot.orders.some((row) => row.service === "numbers" && row.status === "active" && row.otpCode)).toBe(false);
    expect(snapshot.walletTransactions.length).toBe(0);
  });
});
