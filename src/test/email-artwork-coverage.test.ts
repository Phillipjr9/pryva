import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAccountClosedEmail } from "@/lib/email/account-closed-email";
import { requestEmailChange } from "@/lib/identity/email-change";
import { customerWelcomeEmail, emailVerificationEmail, emailVerifiedEmail, giftCardEmail, passwordResetEmail } from "@/lib/email/email-templates";
import { makeEsimDeliveryEmail } from "@/lib/email/esim-email-template";
import { makeNumberCodeEmail } from "@/lib/email/number-email-template";
import { buildSecurityNotice } from "@/lib/platform/security-notice";
import { makeSupportReplyEmail } from "@/lib/email/support-reply-email";
import { makeWalletEmail, type WalletEmailEvent } from "@/lib/email/wallet-email-template";

// Every entry renders its real template. The confirmation email is captured from
// the real sender with only its database and external provider stubbed; the
// database-backed identity change is separately exercised in email-change.test.ts.
const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const at = new Date("2026-11-05T12:30:00Z");
const recipient = "ada@example.test";
const sender = "Pryva <mail@example.test>";
const ref = `WD-${"a".repeat(24)}`;
const ledger = (event: WalletEmailEvent) => makeWalletEmail(event, recipient, sender).html;

async function collect() {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://pryvalogs.com");
  const entries: Array<[string, string, string]> = [
    ["verification link", emailVerificationEmail("Ada", "https://pryvalogs.com/verify-email?token=fake").html, "hero-verify.jpg"],
    ["verification receipt", emailVerifiedEmail("Ada", recipient, at).html, "hero-verified.jpg"],
    ["welcome", customerWelcomeEmail("Ada").html, "hero-welcome.jpg"],
    ["password reset", passwordResetEmail("Ada", "https://pryvalogs.com/reset-password?token=fake").html, "hero-password.jpg"],
    ["password changed", buildSecurityNotice("password_changed", "Ada", at).html, "hero-password-changed.jpg"],
    ["email changed", buildSecurityNotice("email_changed", "Ada", at).html, "hero-email-changed.jpg"],
    ["2FA enabled", buildSecurityNotice("two_factor_enabled", "Ada", at).html, "hero-two-factor-on.jpg"],
    ["2FA disabled", buildSecurityNotice("two_factor_disabled", "Ada", at).html, "hero-two-factor-off.jpg"],
    ["passkey added", buildSecurityNotice("passkey_added", "Ada", at).html, "hero-passkey-added.jpg"],
    ["passkey removed", buildSecurityNotice("passkey_removed", "Ada", at).html, "hero-passkey-removed.jpg"],
    ["account closed", buildAccountClosedEmail(at).html, "hero-account-closed.jpg"],
    ["support reply", makeSupportReplyEmail({ ticketId: "14141414-1414-4141-8141-141414141414", recipient, sender, name: "Ada", createdAt: at }).html, "hero-support-reply.jpg"],
    ["gift card delivery", giftCardEmail({ code: "PRYVA-ABCD-EFGH-JKLM", amount: 2500, senderName: "Ada" }).html, "hero-gift.jpg"],
    ["wallet top-up", ledger({ kind: "wallet", type: "credit", amount: 2500, reference: `TOP-${"a".repeat(24)}`, description: "Paystack wallet top-up", createdAt: at }), "hero-wallet.jpg"],
    ["wallet credit", ledger({ kind: "wallet", type: "credit", amount: 2500, reference: "OTHER", description: "Credit", createdAt: at }), "hero-wallet-credit.jpg"],
    ["wallet debit", ledger({ kind: "wallet", type: "debit", amount: 2500, reference: "OTHER", description: "Debit", createdAt: at }), "hero-wallet-debit.jpg"],
    ["gift card redeemed", ledger({ kind: "wallet", type: "credit", amount: 2500, reference: "GIFT-PRYVA-ABCD-EFGH-JKLM", description: "Gift card redemption: PRYVA-ABCD-EFGH-JKLM", createdAt: at }), "hero-gift-redeemed.jpg"],
    ["refund credited", ledger({ kind: "wallet", type: "refund", amount: 2500, reference: "OTHER", description: "Refund", createdAt: at }), "hero-refund.jpg"],
    ["withdrawal requested", ledger({ kind: "wallet", type: "withdrawal", amount: 2500, reference: ref, description: "Withdrawal", createdAt: at }), "hero-withdrawal.jpg"],
    ["withdrawal processing", ledger({ kind: "withdrawal_processing", amount: 2500, reference: ref, createdAt: at }), "hero-withdrawal-processing.jpg"],
    ["withdrawal complete", ledger({ kind: "withdrawal_completed", amount: 2500, reference: ref, createdAt: at }), "hero-withdrawal-completed.jpg"],
    ["withdrawal rejected", ledger({ kind: "withdrawal_rejected", amount: 2500, reference: ref, createdAt: at }), "hero-withdrawal-rejected.jpg"],
    ["withdrawal failed", ledger({ kind: "withdrawal_failed", amount: 2500, reference: ref, createdAt: at }), "hero-withdrawal-failed.jpg"],
    ["first purchase", ledger({ kind: "first_purchase", amount: 2500, reference: `PRY-${"A".repeat(21)}`, description: "Order payment", productName: "Number", createdAt: at }), "hero-first-purchase.jpg"],
    ["purchase recorded", ledger({ kind: "purchase_recorded", amount: 2500, reference: `PRY-${"A".repeat(21)}`, description: "Order payment", productName: "Number", createdAt: at }), "hero-purchase-receipt.jpg"],
    ["marketplace delivered", ledger({ kind: "purchase_completed", amount: 2500, reference: `MKT-${"a".repeat(28)}`, createdAt: at }), "hero-order.jpg"],
    ["eSIM delivery", makeEsimDeliveryEmail({ recipient, sender, orderReference: "preview", productName: "eSIM", planLabel: "5 GB", region: "Europe", duration: "30 days", activationCode: "LPA:1$example.test$SAMPLE", installUrl: null, iccid: null, orderUrl: "https://pryvalogs.com/dashboard/esim", attachment: null }).html, "hero-esim-delivery.jpg"],
    ["number code", makeNumberCodeEmail({ recipient, sender, orderReference: "preview", productName: "Number", planLabel: "Single", region: "Nigeria", phoneNumber: null, code: "123456", expiresAt: at, orderUrl: "https://pryvalogs.com/dashboard/orders" }).html, "hero-number-code.jpg"],
    ["bank linked", ledger({ kind: "bank_linked", bankName: "Example Bank", lastFour: "1234", createdAt: at }), "hero-bank.jpg"],
  ];

  // Exercise the real direct confirmation sender without making a network call.
  const user = { id: "14141414-1414-4141-8141-141414141414", name: "Ada", email: recipient };
  let selects = 0;
  const db = {
    select() {
      const result = ++selects === 2 ? [] : [user];
      const query = { from: () => query, where: () => query, limit: async () => result, for: async () => result };
      return query;
    },
    delete() { return { where: async () => [] }; },
    insert() { return { values: async () => [] }; },
    transaction(callback: (tx: unknown) => Promise<unknown>) { return callback(db); },
  };
  mocks.db = db;
  let confirmationHtml = "";
  vi.stubEnv("RESEND_API_KEY", "re_preview_test");
  vi.stubEnv("RESEND_FROM_EMAIL", sender);
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    confirmationHtml = (JSON.parse(String(init.body)) as { html: string }).html;
    return new Response(JSON.stringify({ id: "preview" }), { status: 200 });
  }));
  expect(await requestEmailChange({ userId: user.id, newEmail: "new@example.test" })).toMatchObject({ ok: true });
  entries.push(["confirm new email", confirmationHtml, "hero-email-confirm.jpg"]);
  return entries;
}

describe("customer notification artwork coverage", () => {
  it("uses a different real image for every audited live template and state", async () => {
    const entries = await collect();
    const paths = entries.map(([label, html, expected]) => {
      const match = html.match(/\/images\/email\/(hero-[a-z-]+\.jpg)/);
      expect(match?.[1], label).toBe(expected);
      return expected;
    });
    expect(new Set(paths).size).toBe(entries.length);
    const images = await Promise.all(paths.map((path) => readFile(`public/images/email/${path}`)));
    expect(images.every((image) => image.length > 10_000 && image.subarray(0, 2).toString("hex") === "ffd8")).toBe(true);
    expect(new Set(images.map((image) => createHash("sha256").update(image).digest("hex"))).size).toBe(entries.length);
  });
});
