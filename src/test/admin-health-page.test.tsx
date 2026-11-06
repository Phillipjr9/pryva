// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const dbSelect = vi.hoisted(() => vi.fn());

vi.mock("@/lib/identity/auth", () => ({ requireAdmin: vi.fn().mockResolvedValue({ id: "admin-1" }) }));
vi.mock("@/lib/payments/daily-reconciliation", () => ({
  recentReconciliationRuns: async () => [],
  ledgerBreaks: async () => [],
}));
vi.mock("@/db", () => ({
  db: {
    select: dbSelect,
  },
}));
vi.mock("@/lib/admin/fraud", () => ({
  listFraudEvents: async () => [
    {
      id: "fraud-1",
      kind: "withdrawal_review",
      severity: "high",
      reasons: "account is less than three days old; payout account has never been paid before",
      amount: 5000,
      reference: "W-123",
      createdAt: new Date().toISOString(),
      reviewedAt: null,
      userEmail: "alice@example.com",
    },
  ],
}));

import AdminHealthPage from "@/app/admin/(console)/health/page";

beforeEach(() => {
  dbSelect.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        orderBy: () => ({
          limit: async () => [],
        }),
      }),
    }),
  }));
});

afterEach(() => {
  cleanup();
  dbSelect.mockClear();
});

describe("the admin health page", () => {
  it("shows an open fraud signal in the operations watchlist", async () => {
    render(await AdminHealthPage());

    expect(screen.getByText(/open fraud signals/i)).toBeTruthy();
    expect(screen.getByText(/withdrawal flagged/i)).toBeTruthy();
  });
});
