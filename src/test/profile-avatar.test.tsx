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
 * The sidebar used to show one of four generated 3D characters. Those are gone
 * with the rest of the 3D set: it now draws the interface's own flat `User` glyph
 * on a tinted circle. What matters for a mark that is derived rather than
 * uploaded: it must be the SAME on every render (otherwise it flicks between
 * tints on navigation and disagrees between server and client), it must differ
 * between accounts, and it must never claim to be a photograph.
 */

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Ada Demo",
  email: "demo@example.test",
  walletBalance: 25_000,
  emailVerifiedAt: new Date("2026-10-01T09:00:00Z"),
  createdAt: new Date("2026-10-01T09:00:00Z"),
};

describe("avatar selection", () => {
  it("is stable for the same account", () => {
    expect(avatarNumberFor("demo@example.test")).toBe(avatarNumberFor("demo@example.test"));
    expect(avatarNumberFor("")).toBe(avatarNumberFor(""));
  });

  it("stays inside the set that exists on disk", () => {
    for (const seed of ["a@b.co", "demo@example.test", "z".repeat(200), "😀", ""]) {
      const n = avatarNumberFor(seed);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(AVATAR_COUNT);
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  it("spreads different accounts across the set", () => {
    const picks = new Set(
      ["ada@example.com", "bola@example.com", "chidi@example.com", "demo@example.test", "ops@example.com"].map(
        avatarNumberFor,
      ),
    );
    expect(picks.size).toBeGreaterThan(1);
  });

  it("draws a flat glyph instead of loading a picture", () => {
    const html = renderToStaticMarkup(<ProfileAvatar seed="demo@example.test" />);
    expect(html).toContain("<svg");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("/images/avatars/");
    // The name is always the text next to it, so the icon is decorative.
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("aria-label=");
  });

  it("gives the same account the same tint, and different accounts different tints", () => {
    const tintOf = (seed: string) =>
      renderToStaticMarkup(<ProfileAvatar seed={seed} />).match(/background:(#[0-9A-Fa-f]{6})/)?.[1];

    expect(tintOf("demo@example.test")).toBe(tintOf("demo@example.test"));
    const tints = new Set(
      ["ada@example.com", "bola@example.com", "chidi@example.com", "demo@example.test"].map(tintOf),
    );
    expect(tints.size).toBeGreaterThan(1);
    for (const tint of tints) expect(tint).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

describe("where the picture appears", () => {
  /**
   * The dashboard is text-only now: the sidebar and the settings Profile section
   * carry the customer's name, not a derived mark. The avatar helpers stay
   * exported (other surfaces may use them), so what matters here is that no
   * mark and no claim about the person's appearance reached the dashboard.
   */
  it("shows the customer's name in the sidebar instead of a generated mark", () => {
    const html = renderToStaticMarkup(
      <DashboardShell buildId="test" user={{ name: user.name, email: user.email, walletBalance: 0 }}>
        <p>content</p>
      </DashboardShell>,
    );
    expect(html).not.toContain("/images/avatars/");
    expect(html).not.toContain("ring-1 ring-black/5");
    expect(html).not.toContain(">AD<");
    expect(html).toContain("Ada Demo");
  });

  it("heads the Profile section in settings with its name, not a portrait", () => {
    const html = renderToStaticMarkup(<SettingsForm user={user} canSendVerification={false} />);
    expect(html).not.toContain("/images/avatars/");
    expect(html).not.toContain("ring-1 ring-black/5");
    expect(html).toContain("Profile");
  });
});
