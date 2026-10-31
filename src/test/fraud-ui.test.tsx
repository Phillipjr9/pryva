// @vitest-environment jsdom
import React from "react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { FraudQueue } from "@/app/admin/security/FraudQueue";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const read = (path: string) => readFileSync(path, "utf8");
const securityPage = read("src/app/admin/security/page.tsx");
const queue = read("src/app/admin/security/FraudQueue.tsx");
const fraudApi = read("src/app/api/admin/security/fraud/route.ts");
const withdrawalsApi = read("src/app/api/admin/withdrawals/route.ts");
const withdrawalsUi = read("src/app/admin/withdrawals/WithdrawalsManager.tsx");
const withdrawRoute = read("src/app/api/wallet/withdraw/route.ts");
const ordersRoute = read("src/app/api/orders/route.ts");
const redeemRoute = read("src/app/api/gift-cards/redeem/route.ts");
const signupRoute = read("src/app/api/auth/signup/route.ts");
const googleCallback = read("src/app/api/auth/google/callback/route.ts");

const rendered = renderToStaticMarkup(<FraudQueue />);

/**
 * The operator's side of the fraud controls.
 *
 * The rules that must hold: the queue is advisory (no automated action reads it),
 * it is admin-only, it never moves money, and the customer never learns the
 * thresholds. These assertions are about the shape of the screens and routes,
 * because that is what a later refactor breaks.
 */
describe("the fraud queue", () => {
  it("is on the admin security page, above the client-side telemetry", () => {
    expect(securityPage).toContain("<FraudQueue />");
    expect(securityPage).toContain("requireAdmin()");
    expect(securityPage.indexOf("<FraudQueue />")).toBeLessThan(securityPage.indexOf("<SecurityDashboard />"));
  });

  it("says plainly that it is advisory", () => {
    expect(rendered).toContain("Fraud signals");
    expect(rendered).toContain("Advisory only");
    expect(rendered).toContain("nothing here moves money");
    expect(rendered).toContain("Reading the queue");
  });

  it("labels every kind of signal an operator will see", () => {
    for (const kind of ["withdrawal_review", "withdrawal_velocity", "referral_same_network", "purchase_velocity", "gift_card_velocity"]) {
      expect(queue).toContain(kind);
    }
  });

  it("is admin-only and same-origin, and the only write is a review", () => {
    expect(fraudApi).toContain("authorizeAdminApi");
    expect(fraudApi).toContain("isSameOriginMutation");
    expect(fraudApi).toContain("markFraudEventReviewed");
    expect(fraudApi).toContain('action: "fraud.review"');
    expect(fraudApi).toContain('"Cache-Control": "no-store"');
    // No fraud route may move money.
    expect(fraudApi).not.toContain("creditWallet");
    expect(fraudApi).not.toContain("withdrawals");
  });
});

describe("what the customer sees", () => {
  it("never learns the thresholds or the flag", () => {
    // The withdrawal receipt is the customer-facing list of fields.
    const receipt = withdrawRoute.slice(withdrawRoute.indexOf("function receipt"), withdrawRoute.indexOf("export async function POST"));
    expect(receipt).not.toContain("risk");
    expect(receipt).not.toContain("fraud");
    // The flag is stored on the row for the operator, not returned to the browser.
    expect(withdrawRoute).toContain("riskLevel: risk.level");
    expect(withdrawRoute).toContain("assessWithdrawal");
  });

  it("is told to slow down, not why the ceiling exists", () => {
    expect(ordersRoute).toContain("That is a lot of orders in a short time");
    expect(redeemRoute).toContain("That is a lot of gift cards in one day");
    expect(ordersRoute).not.toContain("velocity limit reached for fraud");
  });
});

describe("where the signals come from", () => {
  it("both signup paths record the network, never the address", () => {
    expect(signupRoute).toContain("recordSignupSignal(request, created.id)");
    expect(googleCallback).toContain("recordSignupSignal(request, created.id)");
  });

  it("the withdrawal assessment is advisory and defaults to no opinion", () => {
    expect(withdrawRoute).toContain("Withdrawal risk assessment skipped");
    expect(withdrawRoute).toContain('level: "low"');
    expect(withdrawRoute).toContain('kind: "withdrawal_review"');
  });

  it("shows the operator the reasons, and says the request has not been actioned", () => {
    expect(withdrawalsApi).toContain("riskLevel: withdrawals.riskLevel");
    expect(withdrawalsApi).toContain("riskReasons: withdrawals.riskReasons");
    expect(withdrawalsUi).toContain("Fraud signal:");
    expect(withdrawalsUi).toContain("Advisory only");
    expect(withdrawalsUi).toContain("the request has not been actioned");
  });
});
