import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(process.cwd(), "src");
const shell = readFileSync(join(root, "components/dashboard/DashboardShell.tsx"), "utf8");

function navHrefs(): string[] {
  return [...shell.matchAll(/href: "([^"]+)"/g)].map((match) => match[1]);
}

/**
 * Does a URL resolve to a real `page.tsx`, route groups included?
 *
 * A directory in parentheses — `(console)`, `(site)` — is an organisational folder
 * that appears in the file path but **not** in the URL. So `/admin/dashboard` may
 * be served from `app/admin/dashboard/page.tsx` or `app/admin/(console)/dashboard/page.tsx`,
 * and which one is a filing decision nobody should have to encode in a test.
 *
 * This walks the URL segment by segment, following every branch at each level, and
 * treats each parenthetical directory as transparent — it can be entered or skipped
 * wherever it occurs, including around the final segment. Then the last step
 * accepts `page.tsx` either directly or behind one more group.
 */
function pageExists(href: string): boolean {
  const segments = href.replace(/^\//, "").split("/");

  const groupDirsIn = (dir: string): string[] => {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
    return readdirSync(dir)
      .filter((entry) => entry.startsWith("(") && statSync(join(dir, entry)).isDirectory())
      .map((entry) => join(dir, entry));
  };

  let dirs = [join(root, "app")];
  for (const segment of segments) {
    const next = new Set<string>();
    for (const dir of dirs) {
      next.add(join(dir, segment));
      for (const group of groupDirsIn(dir)) next.add(join(group, segment));
    }
    dirs = [...next].filter((dir) => existsSync(dir) && statSync(dir).isDirectory());
    if (dirs.length === 0) return false;
  }

  for (const dir of dirs) {
    if (existsSync(join(dir, "page.tsx"))) return true;
    for (const group of groupDirsIn(dir)) {
      if (existsSync(join(group, "page.tsx"))) return true;
    }
  }
  return false;
}

describe("dashboard navigation", () => {
  it("mounts a floating support button in the global app shell", () => {
    const layout = readFileSync(join(root, "app/layout.tsx"), "utf8");
    const widget = readFileSync(join(root, "components/site/SupportFloatButton.tsx"), "utf8");
    expect(layout).toContain("SupportFloatButton");
    expect(widget).toContain("floating");
    expect(widget).toContain("useEffect");
    expect(widget).toContain("scroll");
  });

  it("only links to pages that exist", () => {
    const broken = navHrefs().filter((href) => !pageExists(href));
    expect(broken).toEqual([]);
  });

  it("routes accounts directly to the dashboard browser instead of an extra hub step", () => {
    expect(shell).toContain('{ href: "/dashboard/accounts", label: "Accounts", art: "accounts"');
    expect(shell).not.toContain('{ href: "/accounts"');
    const explorer = readFileSync(join(root, "lib/services/service-explorer.ts"), "utf8");
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
      "/dashboard/settings",
      "/dashboard/support",
    ]) {
      expect(linked.has(href), `${href} should be in the sidebar`).toBe(true);
    }
  });

  it("exposes the major shopping categories through the country-first hub", () => {
    for (const category of ["verification", "social", "numbers", "esim", "proxies", "email", "subscriptions", "data", "games", "topups", "gift-cards", "prepaid"]) {
      expect(shell, `${category} should have a hub shortcut`).toContain(`category: "${category}"`);
    }
    expect(shell).toContain('href: "/dashboard/gift-cards", label: "Pryva gift cards"');
    // Every row, including this one, carries a real image rather than a glyph.
    expect(shell).toContain('label: "All services", nav: "services"');
  });

  it("gives the bottom bar exactly five thumb-reach tabs", () => {
    const tabs = shell.slice(shell.indexOf("const mobileTabs"));
    const count = (tabs.match(/\{ href: "/g) ?? []).length;
    expect(count).toBe(5);
  });

  it("keeps support reachable, without a second header button for it", () => {
    // Support has always been one tap away: the sidebar links it on desktop and
    // the bottom bar has a Support tab on phones. The header's "Need help?"
    // button was a third route to the same page, and it was the control that
    // pushed the header row past the available width — which is what made the
    // balance, the bell and the buttons overlap. The requirement is that support
    // stays reachable, not that this particular button exists.
    expect(shell).toContain('{ href: "/dashboard/support", label: "Support"');
    expect(shell).toContain('{ href: "/dashboard/support", label: "Support", nav: "support" }');
    // The button itself is gone. Assert on the rendered text, not on the file:
    // the comment explaining the removal is allowed to name it.
    expect(shell).not.toContain(">\n                Need help?\n");
  });

  it("keeps controls in one row on ordinary phones and can wrap on tiny screens", () => {
    const header = shell.slice(shell.indexOf("rounded-[1.25rem]"), shell.indexOf("<main"));
    expect(header).toContain("max-[340px]:flex-wrap");
    expect(header).not.toMatch(/(?<!:)\bflex-wrap\b/);
    // The greeting yields space instead of the controls at ordinary widths.
    expect(header).toContain("truncate text-[0.875rem]");
    expect(header).toContain("shrink-0 items-center");
  });

  it("renders the bell icon-only in the header, with no label to wrap", () => {
    // The bell was given `h-9 w-9 p-0` from outside while still rendering a
    // "Notifications" label and its own padding. The label could not fit, and
    // `overflow-wrap: anywhere` from the shared `.btn` rule broke it one
    // character per line — the vertical "Notifications" that ran out of the bar.
    expect(shell).not.toContain("NotificationBell className=\"h-9 w-9 p-0\"");
    expect(shell).toContain("<NotificationBell iconOnly />");
  });

  it("lifts the floating help button clear of the mobile tab bar", () => {
    // The tab bar is `fixed inset-x-0 bottom-0`; the floating button is also
    // `fixed`, at `bottom-4`. On a phone that put the pill on top of the tabs and
    // covered the Support tab — the same destination it opens. On dashboard
    // routes it has to sit above the bar.
    expect(shell).toContain("fixed inset-x-0 bottom-0 z-50");

    const float = readFileSync(
      join(process.cwd(), "src/components/site/SupportFloatButton.tsx"),
      "utf8",
    );
    expect(float).toContain("raisedAboveTabBar");
    expect(float).toContain("4.75rem");
    // Outside the dashboard there is no tab bar, so the button stays put.
    expect(float).toContain("bottom-4 sm:bottom-5");
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
