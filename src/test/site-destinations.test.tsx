import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteFooter } from "@/components/site/SiteFooter";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import { blogPosts } from "@/lib/blog";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (relative: string) => readFileSync(join(root, relative), "utf8");

function footerHrefs(): string[] {
  return [...renderToStaticMarkup(<SiteFooter />).matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
}

describe("public site destinations", () => {
  it("links every published page from the footer", () => {
    const hrefs = new Set(footerHrefs());
    // /blog, /help, /testimonials and /status were published pages that nothing
    // on the site linked to; /terms and /privacy were missing from the footer
    // while the less central refund and cookie policies were listed.
    for (const href of ["/blog", "/help", "/testimonials", "/status", "/terms", "/privacy", "/refund-policy", "/cookie-policy", "/about", "/how-it-works", "/pricing", "/faq", "/contact", "/digital-services", "/accounts"]) {
      expect(hrefs.has(href), href).toBe(true);
    }
  });

  it("keeps every footer link pointing at a real route", () => {
    for (const href of footerHrefs()) {
      const path = href.split("?")[0].replace(/^\//, "");
      const exists = ["app", "app/(site)", "app/(auth)"].some((base) =>
        existsSync(join(root, base, path, "page.tsx")),
      );
      expect(exists, href).toBe(true);
    }
  });

  it("lists the help centre, feedback page and every blog post in the sitemap", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain("https://pryva.ng/help");
    expect(urls).toContain("https://pryva.ng/testimonials");
    for (const post of blogPosts) expect(urls).toContain(`https://pryva.ng/blog/${post.slug}`);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("keeps crawlers out of the authenticated areas", () => {
    const rules = robots().rules;
    const disallow = Array.isArray(rules) ? rules[0].disallow : rules.disallow;
    expect(disallow).toEqual(expect.arrayContaining(["/dashboard", "/admin", "/api"]));
  });

  it("renders one header on the catalog pages, not a second stale sign-in bar", () => {
    for (const page of ["virtual-numbers", "esim", "proxies", "email-otp", "pricing"]) {
      const source = read(`app/(site)/${page}/page.tsx`);
      expect(source, page).not.toContain("<header");
    }
  });

  it("uses the shared support form on the public contact page", () => {
    const source = read("app/(site)/contact/page.tsx");
    expect(source).toContain('import { ContactForm } from "@/components/site/ContactForm"');
    // The duplicated form saved machine topics ("general", "billing") while the
    // dashboard form saved labels ("Wallet or refund") into the same column.
    expect(source).not.toContain('"use client"');
    expect(source).not.toContain('value: "general"');
    expect(source).toContain("export const metadata");
  });

  it("offers the demo marketplace instead of a dead end when listings are unavailable", () => {
    const browser = read("app/(site)/accounts/AccountsBrowser.tsx");
    expect(browser).toContain("preview = false");
    expect(browser).toContain("Try the demo marketplace instead");
    expect(browser).toContain("/login?next=%2Fdashboard%2Faccounts");
    expect(read("app/(site)/accounts/page.tsx")).toContain("preview={isPreviewDatabase()}");
  });

  it("routes the help centre's wallet link through sign-in for signed-out visitors", () => {
    expect(read("app/(site)/help/page.tsx")).toContain("/login?next=%2Fdashboard%2Fwallet");
  });
});
