import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const shell = readFileSync(join(root, "components/dashboard/DashboardShell.tsx"), "utf8");

/**
 * One balance per surface, and a nav that fits.
 *
 * `/dashboard/wallet` rendered the same number four times: the sidebar card,
 * the page's own dark "Available now" hero, the chip in the top bar, and the
 * "Balance ₦x" pill inside the top-up form. The sidebar card was also the most
 * expensive one — it spent ~110px of a fixed `calc(100vh - 2.5rem)` column that
 * already had to hold 27 links, which is why "Accounts" was cut in half at the
 * bottom of the screen on a 900px-tall laptop.
 */
describe("sidebar", () => {
  it("shows the balance once", () => {
    // Rendered, not merely interpolated into an aria-label.
    const rendered = [...shell.matchAll(/^\s*\{formatNaira\(user\.walletBalance\)\}\s*$/gm)].length;
    expect(rendered).toBe(1);
    expect(shell).not.toContain("Wallet balance</p>");
    expect(shell).not.toContain("Top up wallet");
  });

  it("keeps the balance where it is reachable from every page", () => {
    // The top-bar chip: one link to the wallet, labelled for screen readers.
    expect(shell).toContain("aria-label={`Wallet balance ${formatNaira(user.walletBalance)}");
    expect(shell).toContain('href="/dashboard/wallet"');
  });

  it("lets the nav scroll on its own and says so", () => {
    const nav = shell.match(/<nav aria-label="Dashboard navigation"[^>]*>/)?.[0] ?? "";
    // min-h-0 + flex-1 is what stops a growing list from pushing the profile
    // block out of the fixed-height column instead of scrolling.
    expect(nav).toContain("min-h-0");
    expect(nav).toContain("flex-1");
    expect(nav).toContain("overflow-y-auto");
    expect(nav).toContain("nav-scroll");
  });

  it("gives the scroll container a visible thumb", () => {
    const css = readFileSync(join(root, "app/globals.css"), "utf8");
    const rule = css.slice(css.indexOf(".nav-scroll {"), css.indexOf("}", css.indexOf(".nav-scroll {")));
    expect(rule).toContain("scrollbar-width: thin");
    expect(rule).toContain("overscroll-behavior: contain");
  });
});
