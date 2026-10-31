import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardShell } from "@/components/dashboard/DashboardShell";

/**
 * An administrator must be recognisable from inside the product.
 *
 * Administrator access is derived (`ADMIN_EMAILS` + a verified email), not stored
 * on the user row, so the customer dashboard had no idea the account had the
 * privilege: no console link, no marker, and the operator concluded the setting
 * had not taken effect. These assertions are about the rendered sidebar.
 *
 * The negative case matters as much as the positive one: the console link must
 * not appear for a customer, or the gate would be advertised to everyone who
 * signs in.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

const render = (isAdmin: boolean) =>
  renderToStaticMarkup(
    <DashboardShell
      buildId="test"
      isAdmin={isAdmin}
      user={{ name: "Ada", email: "ada@example.test", walletBalance: 0 }}
    >
      <p>content</p>
    </DashboardShell>,
  );

describe("administrator identity in the dashboard", () => {
  it("gives an administrator a way into the console", () => {
    const html = render(true);
    expect(html).toContain('href="/admin/dashboard"');
    expect(html).toContain("Admin console");
    expect(html).toContain("Administrator");
  });

  it("leaves a customer's dashboard exactly as it was", () => {
    const html = render(false);
    expect(html).not.toContain("/admin/dashboard");
    expect(html).not.toContain("Admin console");
    expect(html).not.toContain("Administrator");
  });

  it("keeps the customer dashboard intact for an administrator too", () => {
    // The console is appended, not swapped in: an operator still buys, tops up and
    // reads orders from the same dashboard, so the customer destinations survive.
    const html = render(true);
    expect(html).toContain('href="/dashboard/wallet"');
    expect(html).toContain('href="/dashboard/orders"');
    expect(html).toContain('href="/dashboard/settings"');
  });
});
