import { afterAll, describe, expect, it, vi } from "vitest";

describe("an unconfigured preview database", () => {
  afterAll(() => vi.unstubAllEnvs());

  it("starts without shared accounts, wallets, payment history, orders or notices", async () => {
    for (const name of ["DATABASE_URL", "PGHOST", "PGUSER", "AWS_REGION", "AWS_ROLE_ARN"]) vi.stubEnv(name, "");
    const { readPreviewDatabase } = await import("@/db");
    const snapshot = readPreviewDatabase((data) => data);
    for (const table of ["users", "sessions", "orders", "walletTransactions", "paymentTopups", "notifications", "withdrawals"] as const) {
      expect(snapshot[table], table).toEqual([]);
    }
  });
});
