import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardShell } from "@/components/dashboard/DashboardShell";
import { ServiceIcon, type ServiceType } from "@/components/ServiceIcon";
import { EXPLORER_CATEGORIES } from "@/lib/service-explorer";

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
      expect(row.html, `${row.href} should draw an image`).toContain("<img");
    }
  });

  it("does not dress two shelves in the same artwork", () => {
    // "All services" is a signpost, not a shelf: it keeps the sparkle glyph.
    const rows = anchors(render()).filter(
      (anchor) => anchor.href.includes("/dashboard/services") && anchor.href !== "/dashboard/services",
    );
    const subscriptions = rows.find((row) => row.html.includes("Subscriptions"));
    const accounts = rows.find((row) => row.html.includes("Accounts"));

    expect(subscriptions, "Subscriptions row is missing").toBeTruthy();
    expect(accounts, "Accounts row is missing").toBeTruthy();
    expect(subscriptions!.html).toContain("/images/services/subscriptions.png");
    expect(accounts!.html).toContain("/images/services/digital-accounts.png");
    expect(subscriptions!.html).not.toContain("digital-accounts");
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

describe("category artwork", () => {
  it("resolves each shelf to its own file", () => {
    const expected: Array<[ServiceType, string]> = [
      ["app-verification", "app-verification"],
      ["social-promotion", "social-promotion"],
      ["subscriptions", "subscriptions"],
    ];
    for (const [service, file] of expected) {
      const html = decodeURIComponent(renderToStaticMarkup(<ServiceIcon service={service} size="sm" />));
      expect(html, `${service} should use ${file}.png`).toContain(`/images/services/${file}.png`);
      expect(html).toContain(`alt="${service === "app-verification" ? "App Verification" : service === "social-promotion" ? "Social Promotion" : "Subscriptions"}"`);
    }
  });

  it("serves a 64px derivative so a sidebar row is not a 300KB master", () => {
    const html = renderToStaticMarkup(<ServiceIcon service="subscriptions" size="xs" />);
    expect(html).toContain("/images/services/subscriptions-64.webp 64w");
    expect(html).toContain("/images/services/subscriptions-192.webp 192w");
  });
});
