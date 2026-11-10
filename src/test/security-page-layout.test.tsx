// @vitest-environment jsdom
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignupProtection } from "@/app/admin/(console)/security/SignupProtection";

vi.mock("@/lib/platform/turnstile", () => ({
  isTurnstileConfigured: () => true,
  turnstileSiteKey: () => "test-site-key",
  turnstileBuildGap: () => null,
}));

afterEach(cleanup);

describe("security page layout", () => {
  it("keeps the signup shield bounded and shows all protection statuses", () => {
    const { container } = render(<SignupProtection />);
    const shield = container.querySelector("svg");
    expect(shield?.getAttribute("width")).toBe("20");
    expect(shield?.getAttribute("height")).toBe("20");
    expect(shield?.classList.contains("shrink-0")).toBe(true);
    expect(screen.getByRole("heading", { name: "Signup protection" })).toBeTruthy();
    expect(screen.getByRole("list", { name: /current signup defences/i }).children).toHaveLength(4);
    expect(screen.getByText("Bot challenge (Turnstile)")).toBeTruthy();
    expect(screen.getAllByText("active", { selector: ".status-badge" })).toHaveLength(2);
  });
});
