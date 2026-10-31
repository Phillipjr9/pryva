import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { SettingsForm } from "@/app/dashboard/settings/SettingsForm";
import { AVATAR_COUNT, ProfileAvatar, avatarNumberFor } from "@/components/dashboard/ProfileAvatar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard/settings",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

/**
 * The profile picture.
 *
 * The sidebar used to draw the customer's initials in a gradient circle. It now
 * shows one of four 3D avatars, picked from the account itself. What matters for
 * a picture that is derived rather than uploaded: it must be the SAME on every
 * render (otherwise it flicks between avatars on navigation and disagrees between
 * server and client), it must differ between accounts, and it must never claim to
 * be a photograph.
 */

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Ada Demo",
  email: "demo@pryva.ng",
  walletBalance: 25_000,
  emailVerifiedAt: new Date("2026-10-01T09:00:00Z"),
  createdAt: new Date("2026-10-01T09:00:00Z"),
};

describe("avatar selection", () => {
  it("is stable for the same account", () => {
    expect(avatarNumberFor("demo@pryva.ng")).toBe(avatarNumberFor("demo@pryva.ng"));
    expect(avatarNumberFor("")).toBe(avatarNumberFor(""));
  });

  it("stays inside the set that exists on disk", () => {
    for (const seed of ["a@b.co", "demo@pryva.ng", "z".repeat(200), "😀", ""]) {
      const n = avatarNumberFor(seed);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(AVATAR_COUNT);
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  it("spreads different accounts across the set", () => {
    const picks = new Set(
      ["ada@example.com", "bola@example.com", "chidi@example.com", "demo@pryva.ng", "ops@example.com"].map(
        avatarNumberFor,
      ),
    );
    expect(picks.size).toBeGreaterThan(1);
  });

  it("renders a real image with the small derivatives, and no accessible duplication", () => {
    const html = renderToStaticMarkup(<ProfileAvatar seed="demo@pryva.ng" />);
    const n = avatarNumberFor("demo@pryva.ng");
    expect(html).toContain(`/images/avatars/avatar-${n}.png`);
    expect(html).toContain(`/images/avatars/avatar-${n}-64.webp 64w`);
    expect(html).toContain(`/images/avatars/avatar-${n}-192.webp 192w`);
    // The name is always the text next to it, so the picture is decorative.
    expect(html).toContain('alt=""');
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("where the picture appears", () => {
  it("replaces the initials in the dashboard sidebar", () => {
    const html = renderToStaticMarkup(
      <DashboardShell buildId="test" user={{ name: user.name, email: user.email, walletBalance: 0 }}>
        <p>content</p>
      </DashboardShell>,
    );
    expect(html).toContain("/images/avatars/avatar-");
    expect(html).not.toContain(">AD<");
  });

  it("heads the Profile section in settings", () => {
    const html = renderToStaticMarkup(<SettingsForm user={user} canSendVerification={false} />);
    expect(html).toContain("/images/avatars/avatar-");
    expect(html).toContain("Profile");
  });
});
