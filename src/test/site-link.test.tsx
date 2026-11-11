// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * A link costs something before anybody clicks it.
 *
 * In production `next/link` prefetches each link as it scrolls into view. For a
 * prerendered page that is served from the edge cache. For a page rendered per
 * request it is an uncacheable request to the application whose answer is "there
 * is nothing to prefetch" — measured against a production build: 270 bytes,
 * `Cache-Control: private, no-cache, no-store`. The homepage links to ten such
 * pages, so every visitor who scrolled it asked the application about each of
 * them, and a burst on the homepage was a larger burst behind it.
 *
 * `SiteLink` renders those links with `prefetch={false}`. These tests hold the
 * three things that make that true: the rule, the list it reads, and the fact
 * that the shell and the homepage actually use it.
 */

const seen = vi.hoisted(() => ({ links: [] as { href: string; prefetch: unknown }[] }));

vi.mock("next/link", () => ({
  default: ({ href, prefetch, children, ...rest }: { href: string; prefetch?: unknown; children?: ReactNode }) => {
    seen.links.push({ href, prefetch });
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));

import { SiteHeaderNav } from "@/components/site/HeaderNav";
import { SiteFooter } from "@/components/site/SiteFooter";
import { PER_REQUEST_ROUTES, SiteLink, rendersPerRequest } from "@/components/site/SiteLink";
import { SiteSessionProvider, VisitorLink } from "@/components/site/SiteSession";
import { StickyMobileCta } from "@/components/site/StickyMobileCta";

const read = (path: string) => readFileSync(path, "utf8");

function importsOf(source: string): string[] {
  return [...source.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)].map((match) => match[1]);
}

/** Every `page.tsx` below a directory, as [route, source]. Route groups are not part of the URL. */
function pagesUnder(directory: string, route = ""): [string, string][] {
  const found: [string, string][] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      found.push(...pagesUnder(path, /^\(.*\)$/.test(entry) ? route : `${route}/${entry}`));
    } else if (entry === "page.tsx") {
      found.push([route || "/", read(path)]);
    }
  }
  return found;
}

/**
 * What makes a page render for each request, read from its own source: it says
 * so, it reads the request, or it takes the query string as a prop.
 */
function rendersForEachRequest(source: string): boolean {
  const imports = importsOf(source);
  return (
    /^export const dynamic = "force-dynamic"/m.test(source) ||
    imports.includes("next/headers") ||
    imports.includes("@/lib/identity/auth") ||
    /\bsearchParams\b/.test(source)
  );
}

beforeEach(() => {
  seen.links = [];
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const prefetchOf = (href: string) => seen.links.filter((link) => link.href === href).map((link) => link.prefetch);

describe("which links are worth prefetching", () => {
  it("names exactly the public pages that are rendered per request", () => {
    const publicPages = [...pagesUnder("src/app/(site)"), ...pagesUnder("src/app/(auth)")]
      // A link is to a page, not to a pattern: `/blog/[slug]` is prerendered per post.
      .filter(([route]) => !route.includes("["));
    expect(publicPages.length).toBeGreaterThan(20);

    const perRequest = publicPages.filter(([, source]) => rendersForEachRequest(source)).map(([route]) => route);

    // Both ways. A page that became dynamic and is not listed costs a wasted
    // request per visitor; one that became static and is still listed has lost
    // the prefetch that would have made it instant.
    expect([...PER_REQUEST_ROUTES].sort()).toEqual(perRequest.sort());
  });

  it("matches the route, whatever follows it", () => {
    expect(rendersPerRequest("/login")).toBe(true);
    expect(rendersPerRequest("/login?next=%2Fdashboard%2Fdata")).toBe(true);
    expect(rendersPerRequest("/pricing#plans")).toBe(true);
    expect(rendersPerRequest("/pricing/")).toBe(true);
    expect(rendersPerRequest("/signup?ref=ADA")).toBe(true);
  });

  it("leaves prerendered pages, the dashboard and near-misses alone", () => {
    for (const href of ["/", "/about", "/faq", "/blog/how-esims-work", "/dashboard", "/dashboard/data", "/loginx", "/login/help", "/pricing-old", ""]) {
      expect(rendersPerRequest(href), href).toBe(false);
    }
  });
});

describe("SiteLink", () => {
  it("turns prefetching off for a page that has nothing to prefetch", () => {
    render(
      <>
        <SiteLink href="/pricing">Pricing</SiteLink>
        <SiteLink href="/login?next=%2Fdashboard%2Fdata">Data</SiteLink>
        <SiteLink href={{ pathname: "/status" }}>Status</SiteLink>
      </>,
    );

    expect(seen.links.map((link) => link.prefetch)).toEqual([false, false, false]);
  });

  it("keeps the default for a prerendered page: that prefetch is served from the cache", () => {
    render(<SiteLink href="/about">About</SiteLink>);

    // `undefined`, not `true`: Next's own default, unchanged.
    expect(seen.links).toEqual([{ href: "/about", prefetch: undefined }]);
  });

  it("does not overrule a caller that decides for itself", () => {
    render(
      <>
        <SiteLink href="/pricing" prefetch>
          Pricing
        </SiteLink>
        <SiteLink href="/about" prefetch={false}>
          About
        </SiteLink>
        <SiteLink href="/status" prefetch={null}>
          Status
        </SiteLink>
      </>,
    );

    expect(seen.links.map((link) => link.prefetch)).toEqual([true, false, null]);
  });

  it("is still an ordinary link: same destination, same attributes, same children", () => {
    const { container } = render(
      <SiteLink href="/signup" className="btn btn-primary" aria-label="Create an account">
        Get started
      </SiteLink>,
    );

    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("/signup");
    expect(anchor?.className).toBe("btn btn-primary");
    expect(anchor?.getAttribute("aria-label")).toBe("Create an account");
    expect(anchor?.textContent).toBe("Get started");
  });
});

describe("the shell and the homepage use it", () => {
  it.each([
    "src/app/(site)/page.tsx",
    "src/components/site/HeaderNav.tsx",
    "src/components/site/SiteFooter.tsx",
    "src/components/site/SiteSession.tsx",
    "src/components/site/StickyMobileCta.tsx",
  ])("%s links through SiteLink, not next/link directly", (file) => {
    const imports = importsOf(read(file));
    expect(imports).toContain("@/components/site/SiteLink");
    expect(imports).not.toContain("next/link");
  });

  it("the header does not prefetch sign-in, signup or any other per-request page", () => {
    render(
      <SiteSessionProvider>
        <SiteHeaderNav />
      </SiteSessionProvider>,
    );

    expect(seen.links.length).toBeGreaterThan(3);
    for (const link of seen.links) {
      expect(link.prefetch, link.href).toBe(rendersPerRequest(link.href) ? false : undefined);
    }
    expect(prefetchOf("/login")).toContain(false);
    expect(prefetchOf("/signup")).toContain(false);
  });

  it("the footer prefetches the prerendered pages and none of the others", () => {
    render(<SiteFooter />);

    const off = seen.links.filter((link) => link.prefetch === false).map((link) => link.href);
    const kept = seen.links.filter((link) => link.prefetch === undefined).map((link) => link.href);

    // Every link is one or the other; nothing was forced on.
    expect(off.length + kept.length).toBe(seen.links.length);
    expect(off.length).toBeGreaterThan(5);
    for (const href of off) expect(rendersPerRequest(href), href).toBe(true);
    for (const href of kept) expect(rendersPerRequest(href), href).toBe(false);
    for (const href of ["/pricing", "/accounts", "/contact", "/status", "/reviews", "/testimonials", "/signup"]) {
      expect(off, href).toContain(href);
    }
    for (const href of ["/about", "/faq", "/terms", "/privacy"]) expect(kept, href).toContain(href);
  });

  it("links that send a signed-out visitor through sign-in are not prefetched either", () => {
    render(
      <SiteSessionProvider>
        <VisitorLink href="/login?next=%2Fdashboard%2Fdata" signedInHref="/dashboard/data">
          Data Plans
        </VisitorLink>
        <StickyMobileCta label="Explore the catalogue" targetId="final-cta" href="/signup" signedInHref="/dashboard" />
      </SiteSessionProvider>,
    );

    expect(prefetchOf("/login?next=%2Fdashboard%2Fdata")).toEqual([false]);
    expect(prefetchOf("/signup").length).toBeGreaterThan(0);
    for (const prefetch of prefetchOf("/signup")) expect(prefetch).toBe(false);
  });
});
