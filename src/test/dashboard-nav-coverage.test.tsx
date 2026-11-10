import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { ServiceIcon, type ServiceType } from "@/components/ServiceIcon";
import { EXPLORER_CATEGORIES } from "@/lib/services/service-explorer";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

/**
 * The dashboard's Buy list is the customer's map of the catalogue.
 *
 * Two defects made it lie: App verification and Social promotion were the only
 * rows with no mark of their own (a generic phone and a generic people glyph),
 * and Subscriptions borrowed the Digital Accounts tile, so two destinations wore
 * the same face. And `/dashboard/reviews` existed with no link to it anywhere in
 * the app. These assertions are about the rendered sidebar, not the source, so a
 * future refactor has to keep the marks and the destination.
 */

const render = () =>
  renderToStaticMarkup(
    <DashboardShell buildId="test" user={{ name: "Ada", email: "ada@example.test", walletBalance: 0 }}>
      <p>content</p>
    </DashboardShell>,
  );

/** What an icon actually draws, so two rows can be compared by shape. */
function glyphOf(html: string): string {
  return [...html.matchAll(/<svg[^>]*>([\s\S]*?)<\/svg>/g)].map((m) => m[1]).join("|");
}

/** Every anchor in the sidebar, as `{ href, html }`. */
function anchors(html: string): Array<{ href: string; html: string }> {
  const found: Array<{ href: string; html: string }> = [];
  for (const match of html.matchAll(/<a([^>]*)>([\s\S]*?)<\/a>/g)) {
    const href = /href="([^"]*)"/.exec(match[1])?.[1];
    if (href) found.push({ href, html: match[2] });
  }
  return found;
}

describe("dashboard sidebar coverage", () => {
  it("gives every Buy row its own artwork instead of a generic glyph", () => {
    // "All services" is a signpost, not a shelf: it keeps the sparkle glyph.
    const rows = anchors(render()).filter(
      (anchor) => anchor.href.includes("/dashboard/services") && anchor.href !== "/dashboard/services",
    );
    expect(rows.length).toBeGreaterThanOrEqual(
      EXPLORER_CATEGORIES.filter((category) => category.id !== "tools").length,
    );

    for (const row of rows) {
      expect(row.html, `${row.href} should draw a glyph`).toContain("<svg");
      expect(row.html, `${row.href} still loads a picture`).not.toContain("<img");
    }
  });

  it("does not dress two shelves in the same glyph", () => {
    // "All services" is a signpost, not a shelf: it keeps the sparkle glyph.
    const rows = anchors(render()).filter(
      (anchor) => anchor.href.includes("/dashboard/services") && anchor.href !== "/dashboard/services",
    );
    const subscriptions = rows.find((row) => row.html.includes("Subscriptions"));
    const accounts = rows.find((row) => row.html.includes("Accounts"));

    expect(subscriptions, "Subscriptions row is missing").toBeTruthy();
    expect(accounts, "Accounts row is missing").toBeTruthy();
    // Distinct drawings, not just distinct file names: Subscriptions is the
    // recurring-arrows glyph and Accounts is the ID card.
    expect(glyphOf(subscriptions!.html)).not.toBe("");
    expect(glyphOf(subscriptions!.html)).not.toBe(glyphOf(accounts!.html));
  });

  it("provides direct Stars and Call of Duty Mobile links", () => {
    const nav = anchors(render());
    const stars = nav.find((a) => a.href === "/dashboard/telegram-stars");
    const cod = nav.find((a) => a.href === "/dashboard/call-of-duty-mobile");
    expect(stars?.html).toContain("Telegram Stars");
    expect(stars?.html).toContain("<svg");
    expect(cod?.html).toContain("Call of Duty Mobile CP");
    expect(cod?.html).toContain("<svg");
  });

  it("links the review page that used to have no entry point", () => {
    const nav = anchors(render());
    const reviews = nav.find((anchor) => anchor.href === "/dashboard/reviews");
    expect(reviews, "no dashboard link to /dashboard/reviews").toBeTruthy();
    expect(reviews!.html).toContain("Reviews");
  });

  it("keeps every hub category reachable from the sidebar", () => {
    const hrefs = anchors(render()).map((anchor) => anchor.href);
    for (const category of EXPLORER_CATEGORIES) {
      if (category.id === "tools") {
        // The two order tools have pages of their own, which are better than a
        // filtered hub: the link goes straight there.
        expect(hrefs).toContain("/dashboard/bulk-orders");
        expect(hrefs).toContain("/dashboard/scheduled");
        continue;
      }
      expect(hrefs, `${category.id} has no sidebar link`).toContain(
        `/dashboard/services?category=${category.id}`,
      );
    }
    // Gift cards are wallet credit rather than a catalogue service, so they link
    // straight at their own page rather than the hub.
    expect(hrefs).toContain("/dashboard/gift-cards");
  });
});

describe("sidebar and tab icons", () => {
  /** The markup between a nav's opening tag and its closing tag. */
  function navBlock(html: string, label: string): string {
    const start = html.indexOf(`aria-label="${label}"`);
    expect(start, `${label} nav is missing`).toBeGreaterThan(-1);
    return html.slice(start, html.indexOf("</nav>", start));
  }

  it("draws a flat glyph on every sidebar row, including the account rows", () => {
    const html = render();
    const rows = anchors(navBlock(html, "Dashboard navigation"));

    // Overview, Orders, Wallet, Inbox, Referrals, All services, 10 service rows,
    // Notifications, Reviews, Settings, Support.
    expect(rows.length).toBeGreaterThanOrEqual(20);
    for (const row of rows) {
      expect(row.html, `${row.href} draws no icon`).toContain("<svg");
      expect(row.html, `${row.href} still loads a picture`).not.toContain("<img");
    }

    // Every account row keeps its own destination and its own drawing.
    const shapes = new Map<string, string>();
    for (const href of [
      "/dashboard",
      "/dashboard/orders",
      "/dashboard/wallet",
      "/dashboard/inbox",
      "/dashboard/referrals",
      "/dashboard/notifications",
      "/dashboard/reviews",
      "/dashboard/settings",
      "/dashboard/support",
      "/dashboard/services",
    ]) {
      const row = rows.find((anchor) => anchor.href === href);
      expect(row, `${href} is missing from the sidebar`).toBeTruthy();
      const shape = glyphOf(row!.html);
      expect(shape, `${href} draws nothing`).not.toBe("");
      shapes.set(href, shape);
    }
    expect(new Set(shapes.values()).size, "two destinations share one glyph").toBe(shapes.size);
  });

  it("draws glyphs in the mobile tab bar too", () => {
    const rows = anchors(navBlock(render(), "Dashboard sections"));
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row.html, `${row.href} draws no icon`).toContain("<svg");
      expect(row.html, `${row.href} still loads a picture`).not.toContain("/images/nav/");
    }
  });

  it("ships no image requests for the sidebar rows", () => {
    const html = render();
    expect(html).not.toContain("/images/nav/");
    expect(html).not.toContain("/images/services/");
    // Scoped to the nav: the Pryva brand mark elsewhere on the page is a real
    // logo and legitimately goes through next/image.
    const nav = navBlock(html, "Dashboard navigation");
    expect(nav).not.toContain("srcSet");
    expect(nav).not.toContain("<img");
  });
});

describe("category icons", () => {
  it("gives each shelf its own glyph and an accessible name", () => {
    const expected: Array<[ServiceType, string]> = [
      ["app-verification", "Google"],
      ["social-promotion", "Instagram"],
      ["subscriptions", "Spotify"],
    ];
    const shapes = new Set<string>();
    for (const [service, name] of expected) {
      const html = renderToStaticMarkup(<ServiceIcon service={service} size="sm" />);
      expect(html, `${service} still loads a picture`).not.toContain("/images/services/");
      expect(html).toContain(`aria-label="${name}"`);
      shapes.add(glyphOf(html));
    }
    expect(shapes.size).toBe(expected.length);
  });

  it("renders inline at the sidebar's size instead of downloading a tile", () => {
    const html = renderToStaticMarkup(<ServiceIcon service="subscriptions" size="xs" />);
    expect(html).toContain("<svg");
    expect(html).not.toContain("srcSet");
    expect(html).toContain("width:20px");
  });
});
