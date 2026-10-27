import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const shell = readFileSync(join(root, "components/dashboard/DashboardShell.tsx"), "utf8");

function navHrefs(): string[] {
  return [...shell.matchAll(/href: "([^"]+)"/g)].map((match) => match[1]);
}

function pageExists(href: string) {
  const relative = href.replace(/^\//, "");
  return (
    existsSync(join(root, "app", relative, "page.tsx")) ||
    existsSync(join(root, "app", "(site)", relative, "page.tsx"))
  );
}

describe("dashboard navigation", () => {
  it("only links to pages that exist", () => {
    const broken = navHrefs().filter((href) => !pageExists(href));
    expect(broken).toEqual([]);
  });

  it("keeps accounts inside the dashboard instead of the marketing page", () => {
    expect(shell).toContain('{ href: "/dashboard/accounts", label: "Accounts"');
    expect(shell).not.toContain('{ href: "/accounts"');
  });

  it("links every dashboard page that has content worth reaching", () => {
    const linked = new Set(navHrefs());
    for (const href of [
      "/dashboard",
      "/dashboard/orders",
      "/dashboard/wallet",
      "/dashboard/accounts",
      "/dashboard/digital",
      "/dashboard/notifications",
      "/dashboard/security",
      "/dashboard/settings",
      "/dashboard/support",
    ]) {
      expect(linked.has(href), `${href} should be in the sidebar`).toBe(true);
    }
  });

  it("gives the bottom bar exactly five thumb-reach tabs", () => {
    const tabs = shell.slice(shell.indexOf("const mobileTabs"));
    const count = (tabs.match(/\{ href: "/g) ?? []).length;
    expect(count).toBe(5);
  });
});

/** Every route that renders inside the dashboard layout. */
function dashboardRoutes(): string[] {
  const dir = join(root, "app/dashboard");
  return readdirSync(dir).filter((entry) => statSync(join(dir, entry)).isDirectory());
}

describe("dashboard pages", () => {
  it("have a loading state available for the shell", () => {
    expect(existsSync(join(root, "app/dashboard/loading.tsx"))).toBe(true);
  });

  it("do not reintroduce the old purple/gray design system", () => {
    // WithdrawalDashboard used to be a purple gradient page with gray panels,
    // which read as a different product from every other dashboard screen.
    const offenders: string[] = [];

    function walk(path: string) {
      for (const entry of readdirSync(path)) {
        const full = join(path, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.endsWith(".tsx")) continue;
        const source = readFileSync(full, "utf8");
        const match = source.match(/\b(?:bg|text|border)-(?:purple|indigo|gray)-\d{2,3}\b/);
        if (match) offenders.push(`${full.replace(root, "")}: ${match[0]}`);
      }
    }

    for (const route of dashboardRoutes()) walk(join(root, "app/dashboard", route));
    expect(offenders).toEqual([]);
  });
});
