import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

const { planDestination } = await import("@/lib/plan-destination");
const { ServiceExplorer } = await import("@/components/dashboard/ServiceExplorer");
const { CommandPalette, CommandPaletteTrigger } = await import("@/components/command/CommandPalette");
const { AccountDataPanel } = await import("@/app/dashboard/settings/AccountDataPanel");
const { MessageStatusControl } = await import("@/app/admin/messages/MessageStatusControl");

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

describe("plan links keep their destination", () => {
  it("falls back to the hub category instead of inventing a destination", () => {
    // A bundle whose region is not a single country has no country to select.
    expect(planDestination("vn-otp-5")).toBe("/dashboard/services?category=numbers");
    expect(planDestination("not-a-plan")).toBeNull();
    expect(planDestination("")).toBeNull();
    expect(planDestination(undefined)).toBeNull();
    expect(planDestination(["vn-ng"])).toBeNull();
    expect(planDestination("../admin/dashboard")).toBeNull();
  });

  it("points at the live plan page", () => {
    expect(planDestination("vn-ng")).toBe("/dashboard/services/plan/vn-ng?country=ng");
    expect(planDestination("vn-otp-5")).toBe("/dashboard/services?category=numbers");
  });

  it("is honoured by both auth pages so ?plan= is not dropped", () => {
    for (const page of ["login", "signup"]) {
      const source = read(`app/(auth)/${page}/page.tsx`);
      expect(source, page).toContain("planDestination(plan)");
      expect(source, page).toContain("plan?: string");
    }
  });
});

describe("dashboard dead ends", () => {
  it("says so when an order id does not belong to the visitor", () => {
    const source = read("app/dashboard/orders/[id]/page.tsx");
    expect(source).toContain("notFound();");
    expect(source).not.toContain('redirect("/dashboard/orders")');
  });

  it("shows which link values the service hub could not honour", () => {
    const markup = renderToStaticMarkup(
      <ServiceExplorer
        initialCountry={null}
        initialCategory={null}
        rejectedCountry="zz"
        rejectedCategory="bogus"
      />,
    );
    expect(markup).toContain("which isn");
    expect(markup).toContain("zz");
    expect(markup).toContain("bogus");
    expect(markup).toContain("the selection was reset");

    const clean = renderToStaticMarkup(
      <ServiceExplorer initialCountry="ng" initialCategory="numbers" />,
    );
    expect(clean).not.toContain("the selection was reset");
    expect(clean).toContain("Number plans");
  });

  it("escapes and truncates untrusted link values echoed back to the page", () => {
    const markup = renderToStaticMarkup(
      <ServiceExplorer
        initialCountry={null}
        initialCategory={null}
        rejectedCountry={`"><script>alert(1)</script>${"x".repeat(40)}`}
      />,
    );
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("…");
  });

  it("passes the rejected values from the hub page", () => {
    const source = read("app/dashboard/services/page.tsx");
    expect(source).toContain("rejectedCountry");
    expect(source).toContain("rejectedCategory");
    expect(source).toContain("explorerCategory(category)");
  });
});

describe("features that had an endpoint but no screen", () => {
  it("searches real records from the command palette", () => {
    const source = read("components/command/CommandPalette.tsx");
    expect(source).toContain("/api/search?q=");
    expect(source).toContain("ArrowDown");
    expect(source).toContain('role="listbox"');
    expect(source).toContain("/dashboard/orders/${order.id}");
    const trigger = renderToStaticMarkup(<CommandPaletteTrigger onClick={() => undefined} />);
    // Phones and tablets previously had no way to open the palette at all.
    expect(trigger).toContain("Search the dashboard");
    expect(trigger).toContain("lg:hidden");
    const palette = renderToStaticMarkup(<CommandPalette isOpen onClose={() => undefined} />);
    expect(palette).toContain("Search orders, transactions, gift cards");
    expect(palette).toContain("aria-modal=\"true\"");
  });

  it("is mounted by the dashboard shell only while open", () => {
    const shell = read("components/dashboard/DashboardShell.tsx");
    expect(shell).toContain("{commandPaletteOpen ? (");
    expect(shell).toContain("<CommandPaletteTrigger onClick={() => setCommandPaletteOpen(true)} />");
    expect(shell).not.toContain('<div className="hidden sm:block">\n                <CommandPaletteTrigger');
  });

  it("offers the account data export in settings", () => {
    const panel = renderToStaticMarkup(<AccountDataPanel />);
    expect(panel).toContain("Download my data");
    expect(read("app/dashboard/settings/AccountDataPanel.tsx")).toContain("/api/user/export");
    expect(read("app/dashboard/settings/SettingsForm.tsx")).toContain("<AccountDataPanel />");
    // Closing the account is self-service now, so the panel points at the section
    // that does it (with the deletion terms) instead of at support.
    expect(panel).toContain("Close my account");
    expect(panel).toContain("#close-account");
    expect(read("app/dashboard/settings/page.tsx")).toContain("<DangerZone");
  });

  it("offers the wallet ledger export on the wallet page", () => {
    expect(read("app/dashboard/wallet/page.tsx")).toContain("<ExportTransactionsButton />");
    const source = read("components/dashboard/ExportTransactionsButton.tsx");
    expect(source).toContain("/api/wallet/transactions/export?format=");
    expect(source).not.toContain("alert(");
  });

  it("gives support messages an admin inbox", () => {
    const nav = read("app/admin/AdminNav.tsx");
    expect(nav).toContain('{ href: "/admin/support", label: "Support" }');
    expect(nav).toContain('{ href: "/admin/messages", label: "Contact form" }');
    const page = read("app/admin/messages/page.tsx");
    expect(page).toContain('await requireAdmin("/admin/messages")');
    expect(page).toContain("contactMessages");
    expect(page).toContain("<MessageStatusControl");
    const control = read("app/admin/messages/MessageStatusControl.tsx");
    expect(control).toContain('method: "PATCH"');
    expect(control).toContain("/api/admin/messages");
    expect(renderToStaticMarkup(<MessageStatusControl id="abc" status="open" />)).toContain("In progress");
  });

  it("replaces the invented growth metric with a count somebody has to act on", () => {
    const source = read("app/admin/dashboard/page.tsx");
    expect(source).not.toContain('value: "+12%"');
    // Tickets the assistant could not settle, not form submissions nobody has
    // touched: the number on the dashboard is the work, not the inbox depth.
    expect(source).toContain("Tickets needing a person");
    expect(source).toContain('href: "/admin/support?status=escalated"');
    expect(source).toContain('eq(supportTickets.status, "escalated")');
  });
});

describe("small-screen layout guards", () => {
  // A grid track left implicit is sized to its items' min-content, and truncated
  // order references are wide enough to push a page past a 320px viewport as
  // soon as an order exists. These tracks must stay shrinkable.
  const guarded: Array<[string, string]> = [
    ["app/dashboard/page.tsx", "grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]"],
    ["app/dashboard/loading.tsx", "grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]"],
    ["app/dashboard/wallet/page.tsx", "grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]"],
    ["app/dashboard/support/page.tsx", "grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]"],
  ];

  it.each(guarded)("keeps %s tracks shrinkable", (file, expected) => {
    expect(read(file)).toContain(expected);
    expect(read(file)).not.toMatch(/lg:grid-cols-\[\d(?:\.\d+)?fr_\d(?:\.\d+)?fr\]/);
  });

  it("keeps the live-code card shrinkable at 320px", () => {
    const source = read("components/dashboard/LiveCodeCard.tsx");
    expect(source).toContain('className="grid min-w-0 grid-cols-1 gap-2.5"');
    expect(source).toContain('className="min-w-0 rounded-[1.5rem] border border-line bg-[#fffdfa] p-4 sm:p-5"');
    // The countdown badge is shrink-0; without wrapping it sets the card's
    // min-content width and pushes the whole overview past a 320px viewport.
    expect(source).toContain('flex flex-wrap items-start justify-between gap-x-3 gap-y-2');
  });

  it("lets full-width buttons wrap instead of forcing a minimum width", () => {
    expect(read("components/dashboard/TopUpForm.tsx")).toContain("!whitespace-normal");
  });
});
