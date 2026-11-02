import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { blogPosts, getBlogPost } from "@/lib/blog";
import BlogPage from "@/app/(site)/blog/page";
import BlogArticlePage, { generateStaticParams } from "@/app/(site)/blog/[slug]/page";
import HelpPage from "@/app/(site)/help/page";
import StatusPage from "@/app/(site)/status/page";

afterEach(() => vi.unstubAllEnvs());

/** The one <section> on /status whose heading is `name`, badge included. */
function rowFor(html: string, name: string): string {
  const row = html.split("<section").find((part) => part.includes(`>${name}<`));
  expect(row, `/status is missing the row ${name}`).toBeDefined();
  return row ?? "";
}

describe("public content integrity", () => {
  it("provides a real guide for every blog card", async () => {
    const listing = renderToStaticMarkup(<BlogPage />);
    expect(generateStaticParams()).toHaveLength(blogPosts.length);
    expect(new Set(blogPosts.map((post) => post.slug)).size).toBe(blogPosts.length);
    for (const post of blogPosts) {
      expect(getBlogPost(post.slug)).toBe(post);
      expect(listing).toContain(`/blog/${post.slug}`);
      const html = renderToStaticMarkup(await BlogArticlePage({ params: Promise.resolve({ slug: post.slug }) }));
      expect(html).toContain(post.title);
      expect(html).toContain("All guides");
    }
  });
  it("uses working help links instead of placeholder anchors", () => {
    const html = renderToStaticMarkup(<HelpPage />);
    expect(html).not.toContain('href="#"');
    expect(html).toContain("/blog/esim-travel-guide");
  });
  it("does not invent uptime or incidents and reports derived availability", () => {
    const html = renderToStaticMarkup(<StatusPage />);
    expect(html).toContain("Live monitoring is not connected");
    // Availability is computed from the fulfilment allowlist, so the page can
    // only ever claim a category is orderable if checkout would actually run.
    expect(html).toContain("Virtual numbers (SMS verification &amp; rentals)");
    expect(html).toContain("can be ordered and delivered automatically");
    expect(html).not.toMatch(/99\.\d+%|all systems operational|resolved incident/i);
  });
  it("reports gift cards as available, because Pryva issues them rather than a supplier", () => {
    const html = renderToStaticMarkup(<StatusPage />);
    // The row used to bundle gift cards with categories that have no live
    // fulfilment, so the page said "Not available" while the dashboard sold them.
    expect(html).toContain("Gift cards");
    expect(html).toContain("issued by Pryva from your wallet balance");
    expect(html).not.toContain("Digital subscriptions, gift cards");
  });
  it("never claims a hard-disabled purchase route is available", () => {
    const html = renderToStaticMarkup(<StatusPage />);
    // The old row said "Digital subscriptions, data, bulk and scheduled orders
    // — Available — processed automatically through verified provider
    // integration" while /api/digital/purchase and /api/airtime/purchase were
    // permanent 503s. Those routes now share a fail-closed, mapped supplier
    // path, but the shipping mapping is empty, so the verdict must still be
    // driven by readServiceReadiness() rather than a hard-coded "Available".
    expect(html).not.toContain("Digital subscriptions, data, bulk and scheduled orders");
    expect(html).not.toContain("processed automatically through verified provider integration");

    expect(rowFor(html, "Digital subscriptions")).toContain("Not available");
    expect(rowFor(html, "Digital subscriptions")).toContain("No subscription supplier is connected");
    expect(rowFor(html, "Mobile data and airtime")).toContain("Not available");
    expect(rowFor(html, "Mobile data and airtime")).toContain("no supplier is connected");
  });

  it("reports eSIM from the live gate, not the withdrawn written plans", () => {
    const off = renderToStaticMarkup(<StatusPage />);
    expect(rowFor(off, "eSIM data plans")).toContain("Not available");
    expect(rowFor(off, "eSIM data plans")).not.toContain("None of the 6 plans");

    // A configured network key is the same gate /esim and checkout read.
    vi.stubEnv("BITCALL_KEY_ID", "ak_test_key");
    vi.stubEnv("BITCALL_API_SECRET", "test-secret");
    const on = renderToStaticMarkup(<StatusPage />);
    expect(rowFor(on, "eSIM data plans")).toContain("Available");
    expect(rowFor(on, "eSIM data plans")).toContain("read live from the network");
  });

  it("does not promise automatic refunds or unverified top-up credit", () => {
    const dashboard = readFileSync(fileURLToPath(new URL("../app/dashboard/page.tsx", import.meta.url)), "utf8");
    const topUp = readFileSync(fileURLToPath(new URL("../app/dashboard/wallet/TopUpReturn.tsx", import.meta.url)), "utf8");
    expect(dashboard).not.toContain("Nothing arrives? Nothing lost");
    expect(dashboard).toContain("Refund eligibility");
    expect(topUp).not.toMatch(/lands (?:in your wallet )?automatically/);
    expect(topUp).toContain("before paying again");
  });
});
