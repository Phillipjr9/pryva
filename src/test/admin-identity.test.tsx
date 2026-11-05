import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

/**
 * The operator's identity must not leak into the customer storefront.
 *
 * This file used to assert the opposite: that an administrator saw an "Admin
 * console" link and an "Administrator" badge inside the customer dashboard. That
 * was right while the console was a tab bolted onto the storefront. Now that the
 * two are separate products -- `/dashboard` redirects an operator to `/admin`
 * -- the same affordance became a way to see a wallet, a cart and a spend
 * history while holding the account that approves withdrawals.
 *
 * So the assertions inverted. What must hold now:
 *
 *   1. the customer shell never renders operator chrome, for anyone; and
 *   2. the dashboard layout turns an administrator away before the shell runs.
 *
 * Point 2 is the load-bearing one; point 1 keeps a future edit from quietly
 * reintroducing the badge while point 2 still happens to pass.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

const root = join(process.cwd(), "src");
const read = (path: string) => readFileSync(join(root, path), "utf8");

const render = () =>
  renderToStaticMarkup(
    <DashboardShell
      buildId="test"
      user={{ name: "Ada", email: "ada@example.test", walletBalance: 0 }}
    >
      <p>content</p>
    </DashboardShell>,
  );

describe("operator identity stays out of the customer dashboard", () => {
  it("renders no console link and no administrator badge", () => {
    const html = render();
    expect(html).not.toContain("/admin");
    expect(html).not.toContain("Admin console");
    expect(html).not.toContain("Administrator");
  });

  it("has no way to be told that an account is an administrator", () => {
    // The prop is gone, not merely defaulted to false. A `isAdmin` prop that
    // nothing passes is an invitation to pass it again.
    const shell = read("components/dashboard/DashboardShell.tsx");
    expect(shell).not.toContain("isAdmin");
    expect(shell).not.toContain("operatorGroup");
  });

  it("keeps the customer destinations intact", () => {
    const html = render();
    expect(html).toContain('href="/dashboard/wallet"');
    expect(html).toContain('href="/dashboard/orders"');
    expect(html).toContain('href="/dashboard/settings"');
  });

  it("turns an administrator away before the customer shell renders", () => {
    const layout = read("app/dashboard/layout.tsx");
    // The redirect has to sit after `requireUser` (so `user` is a real row, not
    // a null that `isAdminUser` would read as "customer") and before the JSX.
    const guard = layout.indexOf('if (isAdminUser(user)) redirect("/admin")');
    expect(guard).toBeGreaterThan(layout.indexOf("await requireUser()"));
    expect(guard).toBeLessThan(layout.indexOf("<DashboardShell"));
    // And it must stop the request, not render a banner on top of the page.
    expect(layout).toContain('import { redirect } from "next/navigation"');
  });
});
