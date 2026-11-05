// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsForm } from "@/app/dashboard/settings/SettingsForm";
import { GiftCardsManager } from "@/app/dashboard/gift-cards/GiftCardsManager";
import { BoostPurchaseForm } from "@/app/dashboard/services/boost/[id]/BoostPurchaseForm";
import { EsimBuy } from "@/app/dashboard/esim/[id]/EsimBuy";
import { InboxManager } from "@/app/dashboard/inbox/InboxManager";
import { ReviewForm } from "@/app/dashboard/reviews/ReviewForm";
import { ContactForm } from "@/components/site/ContactForm";
import { OrderActions } from "@/components/dashboard/OrderActions";
import { PlanPurchase } from "@/components/purchase/PlanPurchase";
import { BulkOrdersForm } from "@/app/dashboard/bulk-orders/BulkOrdersForm";
import { findPlan } from "@/lib/services/catalog";
import PageError from "@/app/error";
import GlobalError from "@/app/global-error";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/components/ui/Confetti", () => ({ fireConfetti: vi.fn() }));

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Ada",
  email: "ada@example.test",
  walletBalance: 100_000,
  emailVerifiedAt: new Date("2026-10-01T00:00:00Z"),
  createdAt: new Date("2026-10-01T00:00:00Z"),
};
const listing = { id: "live-boost-0123456789abcdef0123", name: "Instagram Followers", tag: "Followers", min: 100, max: 10_000, perThousand: 1500, terms: "a".repeat(24) };

function response(data: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

beforeEach(() => {
  vi.stubGlobal("crypto", { randomUUID: () => "11111111-2222-4333-8444-555555555555" });
  router.refresh.mockReset();
  router.push.mockReset();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("profile and password errors", () => {
  it("does not display a browser or network exception when saving a profile", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch SECRET_RESPONSE")));
    render(<SettingsForm user={user} canSendVerification={false} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada Lovelace" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    expect(await screen.findByText(/couldn't confirm the profile update/i)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Failed to fetch|SECRET_RESPONSE/);
  });

  it("keeps useful, application-owned password validation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "Current password is incorrect" }, 400)));
    render(<SettingsForm user={user} canSendVerification={false} />);
    fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "old-password" } });
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: "new-password" } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: "new-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText("Current password is incorrect")).toBeTruthy();
  });
});

describe("gift card failures", () => {
  it.each([
    [{ outcome: "refunded", error: "API ERROR secret-response" }, /wallet has been refunded/i],
    [{ outcome: "unconfirmed", reference: "GC-ABCDE1234567890ABCDE", error: "API ERROR secret-response" }, /contact support before placing another/i],
    [{ error: "API ERROR secret-response" }, /contact support before placing another/i],
  ])("renders the financial outcome instead of technical 5xx text", async (body, expected) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body, 502)));
    render(<GiftCardsManager user={user} />);
    fireEvent.click(screen.getByRole("button", { name: /^Pay .* with Wallet$/i }));
    expect(await screen.findByText(expected)).toBeTruthy();
    expect(document.body.textContent).not.toContain("API ERROR");
    expect(document.body.textContent).not.toContain("secret-response");
    if (!("outcome" in body) || body.outcome !== "refunded") expect(document.body.textContent).not.toContain("wallet has been refunded");
    if ("reference" in body) expect(document.body.textContent).toContain(body.reference);
  });

  it("does not expose a network exception during redemption", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch SECRET_RESPONSE")));
    render(<GiftCardsManager user={user} />);
    fireEvent.click(screen.getByRole("button", { name: "Redeem Code" }));
    fireEvent.change(screen.getByPlaceholderText("PRYVA-XXXX-XXXX-XXXX"), { target: { value: "PRYVA-AAAA-BBBB-CCCC" } });
    fireEvent.click(screen.getByRole("button", { name: "Redeem Gift Card" }));
    expect(await screen.findByText(/couldn't confirm the redemption/i)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Failed to fetch|SECRET_RESPONSE/);
  });
});

describe("boost and eSIM purchase errors", () => {
  function boost() {
    render(<BoostPurchaseForm listing={listing} walletBalance={100_000} />);
    fireEvent.change(screen.getByLabelText("Profile or post link"), { target: { value: "https://instagram.com/ada" } });
    fireEvent.click(screen.getByRole("button", { name: /^Pay .* from wallet$/i }));
  }

  it.each([
    [{ outcome: "refunded", error: "API ERROR secret-response" }, /wallet has been refunded/i],
    [{ outcome: "unconfirmed", error: "API ERROR secret-response" }, /couldn't confirm your boost or its refund/i],
    [{ error: "API ERROR secret-response" }, /couldn't confirm this order/i],
  ])("uses the reported refund outcome and hides raw 5xx text", async (body, expected) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(body, 502)));
    boost();
    expect((await screen.findByRole("alert")).textContent).toMatch(expected);
    expect(document.body.textContent).not.toContain("API ERROR");
    expect(document.body.textContent).not.toContain("secret-response");
    if (!("outcome" in body) || body.outcome !== "refunded") expect(document.body.textContent).not.toContain("wallet has been refunded");
  });

  it.each(["refunded", "review", "processing", "delivered"])("does not label a replayed %s order as a newly started boost", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      ok: true, replayed: true, order: { reference: "PRY-BOOST1", amount: 150, quantity: 100, targetLink: "https://instagram.com/ada", status },
    })));
    boost();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("Boost started")).toBeNull();
  });

  it("hides technical 5xx text in eSIM checkout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "API ERROR SECRET_RESPONSE" }, 502)));
    render(<EsimBuy offerId="live-esim-1" name="Travel data" price={2500} expectedTerms="abc" balance={10_000} purchasable />);
    fireEvent.click(screen.getByRole("button", { name: /Buy Travel data/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/check your orders or contact support/i);
    expect(document.body.textContent).not.toMatch(/API ERROR|SECRET_RESPONSE/);
  });

  it("hides technical 5xx text in plan checkout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "API ERROR SECRET_RESPONSE" }, 502)));
    const plan = findPlan("vn-ng")!;
    render(<PlanPurchase groups={[{ label: "Numbers", plans: [plan] }]} signedIn walletBalance={10_000} nextPath="/virtual-numbers" />);
    expect(screen.getByText("Checked at checkout")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pay from wallet" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/check your orders and wallet/i);
    expect(document.body.textContent).not.toContain("SECRET_RESPONSE");
  });

  it("hides technical 5xx text in bulk checkout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "API ERROR SECRET_RESPONSE" }, 502)));
    render(<BulkOrdersForm user={user} sellableSlugs={["vn-ng"]} maxUnits={10} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to Order" }));
    fireEvent.click(screen.getByRole("button", { name: /^Purchase \(1 item\)/ }));
    expect(await screen.findByText(/check your orders and wallet or contact support/i)).toBeTruthy();
    expect(document.body.textContent).not.toContain("SECRET_RESPONSE");
  });

  it("does not invite a fresh eSIM purchase after an ambiguous network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch SECRET_RESPONSE")));
    render(<EsimBuy offerId="live-esim-1" name="Travel data" price={2500} expectedTerms="abc" balance={10_000} purchasable />);
    fireEvent.click(screen.getByRole("button", { name: /Buy Travel data/i }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/check your orders or contact support before trying again/i);
    expect(document.body.textContent).not.toMatch(/Failed to fetch|SECRET_RESPONSE/);
  });
});

describe("uncertain updates", () => {
  const reviewable = [{ id: "00000000-0000-4000-8000-000000000001", reference: "PV-123", productName: "Number", planLabel: "One use", service: "numbers", status: "delivered" }];

  it.each(["network", "server"])("does not say a review was lost after a %s failure", async (kind) => {
    vi.stubGlobal("fetch", kind === "network"
      ? vi.fn().mockRejectedValue(new Error("Failed to fetch SECRET_RESPONSE"))
      : vi.fn().mockResolvedValue(response({ error: "API ERROR SECRET_RESPONSE" }, 500)));
    render(<ReviewForm orders={reviewable} />);
    fireEvent.change(screen.getByLabelText("Your review"), { target: { value: "The number worked and arrived very quickly." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't confirm whether your review was saved.*check/i);
    expect(document.body.textContent).not.toMatch(/was not saved|API ERROR|SECRET_RESPONSE/);
  });

  it("preserves helpful review validation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "This order already has a review." }, 409)));
    render(<ReviewForm orders={reviewable} />);
    fireEvent.change(screen.getByLabelText("Your review"), { target: { value: "The number worked and arrived very quickly." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    expect((await screen.findByRole("alert")).textContent).toBe("This order already has a review.");
  });

  it.each(["network", "server"])("treats a %s refund failure as unconfirmed", async (kind) => {
    vi.stubGlobal("fetch", kind === "network"
      ? vi.fn().mockRejectedValue(new Error("Failed to fetch SECRET_RESPONSE"))
      : vi.fn().mockResolvedValue(response({ error: "API ERROR SECRET_RESPONSE" }, 500)));
    render(<OrderActions orderId="order-1" status="active" expiresAt={null} amount={500} referenceCode="ref" otpCode={null} service="numbers" initialNow={Date.now()} />);
    fireEvent.click(screen.getByRole("button", { name: "Refund this order" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't confirm this refund.*check your wallet/i);
    expect(document.body.textContent).not.toMatch(/didn't go through|API ERROR|SECRET_RESPONSE/);
  });

  it("keeps an eligible-refund explanation from the service", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "This order isn't eligible for an automatic refund." }, 409)));
    render(<OrderActions orderId="order-1" status="active" expiresAt={null} amount={500} referenceCode="ref" otpCode={null} service="numbers" initialNow={Date.now()} />);
    fireEvent.click(screen.getByRole("button", { name: "Refund this order" }));
    expect((await screen.findByRole("alert")).textContent).toBe("This order isn't eligible for an automatic refund.");
  });

  it("does not expose technical details or claim that a contact message was lost", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ error: "API ERROR SECRET_RESPONSE" }, 500)));
    render(<ContactForm defaultName="Ada" defaultEmail="ada@example.test" />);
    fireEvent.change(screen.getByLabelText("How can we help?"), { target: { value: "I need help with my order." } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(await screen.findByText(/couldn't confirm whether your message was sent/i)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/API ERROR|SECRET_RESPONSE/);
  });
});

describe("unavailable pages", () => {
  it.each([
    ["preview", "Temporary inboxes are not available in this preview"],
    ["not_configured", "Temporary inboxes are not available right now"],
  ])("uses customer language for inbox %s", async (reason, title) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ok: true, configured: false, reason, inboxes: [] })));
    render(<InboxManager />);
    expect(await screen.findByText(title)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/mailbox provider|not configured|on this server/i);
  });

  it.each(["network", "server"])("does not claim a new inbox was lost after a %s failure", async (kind) => {
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method) return response({ ok: true, configured: true, inboxes: [] });
      if (kind === "network") throw new Error("Failed to fetch SECRET_RESPONSE");
      return response({ error: "API ERROR SECRET_RESPONSE" }, 502);
    }));
    render(<InboxManager />);
    fireEvent.click(await screen.findByRole("button", { name: "Create free inbox" }));
    expect(await screen.findByText(/couldn't confirm whether your inbox was created/i)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/API ERROR|SECRET_RESPONSE/);
  });

  it("renders a useful error boundary without leaking the exception", () => {
    const reset = vi.fn();
    render(<PageError error={new Error("API ERROR secret-response")} reset={reset} />);
    expect(screen.getByRole("heading", { name: "We couldn't load this page" })).toBeTruthy();
    expect(screen.getByText(/check your orders and wallet/i)).toBeTruthy();
    expect(document.body.textContent).not.toContain("secret-response");
    fireEvent.click(screen.getByRole("button", { name: "Try loading again" }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("keeps the root-layout fallback self-contained and free of raw errors", () => {
    const html = renderToStaticMarkup(<GlobalError error={new Error("API ERROR secret-response")} reset={() => {}} />);
    expect(html).toContain("We couldn&#x27;t load this page");
    expect(html).not.toContain("API ERROR");
    expect(html).not.toContain("secret-response");
  });
});
