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
  it("does not promise automatic refunds or unverified top-up credit", () => {
    const dashboard = readFileSync(fileURLToPath(new URL("../app/dashboard/page.tsx", import.meta.url)), "utf8");
    const topUp = readFileSync(fileURLToPath(new URL("../app/dashboard/wallet/TopUpReturn.tsx", import.meta.url)), "utf8");
    expect(dashboard).not.toContain("Nothing arrives? Nothing lost");
    expect(dashboard).toContain("Refund eligibility");
    expect(topUp).not.toMatch(/lands (?:in your wallet )?automatically/);
    expect(topUp).toContain("before paying again");
  });
});
