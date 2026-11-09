// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CookieConsentBanner } from "@/components/site/CookieConsentBanner";

const key = "pryva_cookie_consent";

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.cookieConsent;
});
afterEach(() => cleanup());

describe("cookie consent", () => {
  it("asks once and remembers the essentials-only choice on reload", () => {
    const first = render(<CookieConsentBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Only essentials" }));
    expect(JSON.parse(window.localStorage.getItem(key)!)).toMatchObject({ accepted: false });
    expect(document.documentElement.dataset.cookieConsent).toBe("declined");
    first.unmount();
    render(<CookieConsentBanner />);
    expect(screen.queryByRole("button", { name: "Only essentials" })).toBeNull();
  });

  it("restores an accepted choice and notifies listeners", () => {
    window.localStorage.setItem(key, JSON.stringify({ accepted: true, createdAt: "2026-01-01T00:00:00Z" }));
    const listener = vi.fn();
    window.addEventListener("pryva-cookie-consent", listener);
    render(<CookieConsentBanner />);
    expect(document.documentElement.dataset.cookieConsent).toBe("accepted");
    expect(listener).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Yes, I accept" })).toBeNull();
    window.removeEventListener("pryva-cookie-consent", listener);
  });

  it("asks again for malformed stored data", () => {
    window.localStorage.setItem(key, "not-json");
    render(<CookieConsentBanner />);
    expect(screen.getByRole("button", { name: "Only essentials" })).toBeTruthy();
  });
});
