import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveCodeCard, type LiveCode } from "@/components/dashboard/LiveCodeCard";
import { OrderActions } from "@/components/dashboard/OrderActions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const initialNow = Date.parse("2030-01-01T00:00:00.000Z");
const expiresAt = new Date(initialNow + 125_000).toISOString();
const code: LiveCode = {
  id: "order-1", productName: "Test", planLabel: "Number", region: "Nigeria", amount: 500,
  referenceCode: "ref", otpCode: null, expiresAt, createdAt: new Date(initialNow).toISOString(),
};

afterEach(() => vi.useRealTimers());

describe("hydration-safe order countdowns", () => {
  it("renders the same live-code countdown even if the browser clock advances before hydration", () => {
    vi.useFakeTimers();
    vi.setSystemTime(initialNow);
    const server = renderToStaticMarkup(<LiveCodeCard codes={[code]} initialNow={initialNow} />);
    vi.setSystemTime(initialNow + 45_000);
    const client = renderToStaticMarkup(<LiveCodeCard codes={[code]} initialNow={initialNow} />);
    expect(server).toBe(client);
    expect(server).toContain("02:05");
  });

  it("renders order details using the server timestamp, not the hydration time", () => {
    vi.useFakeTimers();
    const props = { orderId: "order-1", status: "active", expiresAt, amount: 500, referenceCode: "ref", otpCode: null, service: "numbers", initialNow };
    vi.setSystemTime(initialNow);
    const server = renderToStaticMarkup(<OrderActions {...props} />);
    vi.setSystemTime(initialNow + 45_000);
    const client = renderToStaticMarkup(<OrderActions {...props} />);
    expect(server).toBe(client);
    expect(server).toContain("2m 05s");
    expect(server).not.toContain("Window closed");
  });

  it("offers a resend only when the server says this order can take one", () => {
    const base = { orderId: "order-3", status: "active", expiresAt, amount: 500, referenceCode: "ref", otpCode: null, service: "numbers", initialNow };

    // The capability is decided on the server; the button is not the decision.
    expect(renderToStaticMarkup(<OrderActions {...base} />)).not.toContain("Resend code");
    expect(renderToStaticMarkup(<OrderActions {...base} canResendCode />)).toContain("Resend code");

    // A settled order has nothing to resend, even where the capability is set.
    const past = new Date(initialNow - 60_000).toISOString();
    const closed = renderToStaticMarkup(<OrderActions {...base} expiresAt={past} canResendCode />);
    expect(closed).not.toContain("Resend code");
  });

  it("does not call an order without an expiry window closed", () => {
    const html = renderToStaticMarkup(<OrderActions orderId="order-2" status="active" expiresAt={null} amount={500} referenceCode="ref" otpCode={null} service="numbers" initialNow={initialNow} />);
    expect(html).not.toContain("Window closed");
    expect(html).toContain(">Live</span>");
  });
});
