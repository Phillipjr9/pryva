import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const settings = readFileSync("src/app/dashboard/settings/page.tsx", "utf8");
const section = readFileSync("src/app/dashboard/settings/SecuritySection.tsx", "utf8");
const redirectPage = readFileSync("src/app/dashboard/security/page.tsx", "utf8");
const shell = readFileSync("src/components/dashboard/DashboardShell.tsx", "utf8");
const palette = readFileSync("src/components/command/CommandPalette.tsx", "utf8");
const auth = readFileSync("src/lib/auth.ts", "utf8");

/**
 * Security is part of Settings.
 *
 * The owner's rule, and the reason for it: password, two-factor and sessions are
 * properties of one account, so they belong on the page that edits that account.
 * Two sibling pages that both sound right make a customer guess, and the page
 * they guess first (Settings) had no mention of two-factor at all.
 */
describe("security lives inside settings", () => {
  it("renders the security section on the settings page", () => {
    expect(settings).toContain("SecuritySection");
    expect(settings).toContain("<SecuritySection user={user} />");
    // The section needs an anchor so links can point at it directly.
    expect(section).toContain('id="security"');
    expect(section).toContain("scroll-mt-24");
  });

  it("keeps every security control on that page", () => {
    for (const control of ["TwoFactorCard", "SessionsCard", "remainingRecoveryCodes", "twoFactorAvailable"]) {
      expect(section, control).toContain(control);
    }
    // Nothing was lost in the move: the old page's guidance came too.
    expect(section).toContain("What we do on our side");
    expect(section).toContain("Habits that keep an account safe");
  });

  it("is not a second destination in the sidebar", () => {
    expect(shell).not.toContain('href: "/dashboard/security"');
    expect(shell).toContain('href: "/dashboard/settings"');
  });

  it("keeps the old route working as a redirect, query and all", () => {
    expect(redirectPage).toContain("redirect(");
    expect(redirectPage).toContain("/dashboard/settings");
    expect(redirectPage).toContain("#security");
    // Dropping `require=2fa` would land an administrator on a page with no
    // explanation of why the admin area just refused them.
    expect(redirectPage).toContain("searchParams");
    expect(redirectPage).not.toContain("<h1");
  });

  it("no longer has its own page directory with components in it", () => {
    // The client cards moved with the section; a leftover copy would be a second
    // implementation, and the next fix would land in the wrong one.
    expect(existsSync("src/app/dashboard/security/TwoFactorCard.tsx")).toBe(false);
    expect(existsSync("src/app/dashboard/security/SessionsCard.tsx")).toBe(false);
    expect(existsSync("src/app/dashboard/settings/TwoFactorCard.tsx")).toBe(true);
    expect(existsSync("src/app/dashboard/settings/SessionsCard.tsx")).toBe(true);
  });

  it("sends the admin bounce to the section, not to a missing page", () => {
    expect(auth).toContain("/dashboard/settings?require=2fa");
    expect(auth).toContain("#security");
    expect(auth).not.toContain('redirect(`/dashboard/security');
  });

  it("keeps the command palette shortcut, pointed at the section", () => {
    expect(palette).toContain("/dashboard/settings#security");
    expect(palette).not.toContain('href: "/dashboard/security"');
  });
});
