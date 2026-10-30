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

  it("routes accounts through the country-first dashboard hub instead of the marketing page", () => {
    expect(shell).toContain('{ href: "/dashboard/services", label: "Accounts", art: "accounts", category: "accounts"');
    expect(shell).not.toContain('{ href: "/accounts"');
    const explorer = readFileSync(join(root, "lib/service-explorer.ts"), "utf8");
    expect(explorer).toContain('href: "/dashboard/accounts"');
  });

  it("links every dashboard page that has content worth reaching", () => {
    const linked = new Set(navHrefs());
    for (const href of [
      "/dashboard",
      "/dashboard/orders",
      "/dashboard/wallet",
      "/dashboard/services",
      "/dashboard/bulk-orders",
      "/dashboard/scheduled",
      "/dashboard/notifications",
      "/dashboard/security",
      "/dashboard/settings",
      "/dashboard/support",
    ]) {
      expect(linked.has(href), `${href} should be in the sidebar`).toBe(true);
    }
  });

  it("exposes the major shopping categories through the country-first hub", () => {
    for (const category of ["verification", "social", "numbers", "esim", "proxies", "email", "accounts", "subscriptions", "data"]) {
      // Gift cards are deliberately absent: they are wallet credit Pryva issues
      // itself, not a service in the catalogue.
      expect(shell, `${category} should have a hub shortcut`).toContain(`category: "${category}"`);
    }
    expect(shell).not.toContain('category: "gift-cards"');
    expect(shell).toContain('label: "Services", icon: Sparkle');
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

describe("overview layout", () => {
  const overview = readFileSync(join(root, "app/dashboard/page.tsx"), "utf8");

  it("leads with the wallet balance", () => {
    // The balance is the reason people open this page, so it is the first block.
    const heroIndex = overview.indexOf("<BalanceHero");
    expect(heroIndex).toBeGreaterThan(-1);

    for (const later of ["<LiveCodeCard", "<EmptyState", "Recent orders", "Wallet activity"]) {
      const index = overview.indexOf(later);
      if (index === -1) continue;
      expect(index, `${later} must come after the balance`).toBeGreaterThan(heroIndex);
    }
  });

  it("keeps the money actions attached to the balance, not in a separate header", () => {
    const hero = readFileSync(join(root, "components/dashboard/BalanceHero.tsx"), "utf8");
    expect(hero).toContain("/dashboard/wallet");
    expect(hero).toContain("/dashboard/wallet#withdraw");
    expect(hero).toContain("formatNaira(balance)");
    // The old header repeated the greeting and the buttons above the balance.
    expect(overview).not.toContain("Welcome back");
  });

  it("describes the account with aggregates, never with the visible slice", () => {
    expect(overview).toContain("count()");
    expect(overview).toContain("sum(orders.amount)");
  });
});

describe("balance visibility", () => {
  it("shows the balance in the top bar on every width", () => {
    // It is the number people open the dashboard to check, so it is not hidden
    // behind a `md:` breakpoint any more.
    const chip = shell.slice(shell.indexOf("Wallet balance ${formatNaira"), shell.indexOf("aria-label={`Wallet balance"));
    expect(shell).toContain("aria-label={`Wallet balance ${formatNaira(user.walletBalance)}");
    expect(chip).not.toContain("hidden md:inline-flex");
  });

  it("reserves the balance slot in the loading state", () => {
    const loading = readFileSync(join(root, "app/dashboard/loading.tsx"), "utf8");
    // The first block inside the skeleton must be the dark balance card.
    const firstBlock = loading.slice(loading.indexOf("<SkeletonPage>"));
    expect(firstBlock.indexOf("bg-ink")).toBeGreaterThan(-1);
    expect(firstBlock.indexOf("bg-ink")).toBeLessThan(firstBlock.indexOf("<SkeletonCard"));
  });
});
