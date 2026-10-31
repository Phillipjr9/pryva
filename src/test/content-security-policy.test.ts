import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";
import {
  contentSecurityPolicy,
  isEmbeddedPreviewHost,
} from "@/lib/security-headers";

/**
 * A Content-Security-Policy is only useful if it matches what the app actually
 * loads — and it breaks a deployment the moment the two drift apart. These tests
 * read the real sources of truth (the font links and the image allowlist) rather
 * than restating the policy, so adding a host in one place and forgetting the
 * other fails here instead of showing up as a blocked font in production.
 */

function directives(policy: string): Map<string, string> {
  return new Map(
    policy.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values.join(" ")];
    }),
  );
}

const production = directives(contentSecurityPolicy());
const preview = directives(contentSecurityPolicy({ embeddedPreview: true }));
const development = directives(contentSecurityPolicy({ development: true }));

/** Every `.tsx` / `.ts` file under `src`, for source-scanning guards. */
function sourceFiles(directory = "src"): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry)) found.push(path);
  }
  return found;
}

describe("content security policy", () => {
  it("locks down the defaults that cost nothing", () => {
    expect(production.get("default-src")).toBe("'self'");
    expect(production.get("base-uri")).toBe("'self'");
    expect(production.get("object-src")).toBe("'none'");
    expect(production.get("form-action")).toBe("'self'");
    expect(production.get("frame-src")).toBe("'none'");
    expect(production.get("frame-ancestors")).toBe("'self'");
  });

  it("keeps development-only relaxations out of production", () => {
    expect(production.get("script-src")).not.toContain("unsafe-eval");
    expect(production.get("connect-src")).toBe("'self'");
    expect(development.get("script-src")).toContain("unsafe-eval");
    expect(development.get("connect-src")).toContain("ws:");
  });

  it("allows the app to be framed only in the embedded preview", () => {
    expect(preview.get("frame-ancestors")).toBe("*");
    expect(production.get("frame-ancestors")).toBe("'self'");
  });

  it("no longer allows Google's font hosts, because the fonts are self-hosted", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    const style = production.get("style-src") ?? "";
    const font = production.get("font-src") ?? "";

    // The webfonts come from @fontsource packages bundled into /_next/static.
    // If a <link> to fonts.googleapis.com ever comes back, it will be blocked
    // by this policy rather than quietly re-widening it.
    // The prose above may still name the hosts; what must not come back is a
    // tag that actually fetches from them.
    expect(layout).not.toMatch(/<(?:link|style)[^>]*fonts\.g/i);
    for (const host of ["fonts.googleapis.com", "fonts.gstatic.com"]) {
      expect(style).not.toContain(host);
      expect(font).not.toContain(host);
    }
    expect(style).toMatch(/^'self' 'unsafe-inline'$/);
    expect(font).toMatch(/^'self' data:$/);
  });

  it("allows every image host configured for next/image", () => {
    const img = production.get("img-src") ?? "";
    for (const pattern of nextConfig.images?.remotePatterns ?? []) {
      expect(img, `${pattern.hostname} is allowed by next.config but blocked by CSP`).toContain(
        `https://${pattern.hostname}`,
      );
    }
  });

  it("never widens a script, style or image source to a bare wildcard", () => {
    for (const name of ["script-src", "style-src", "img-src", "font-src", "connect-src"]) {
      expect(production.get(name), name).not.toMatch(/(^|\s)\*(\s|$)/);
      expect(preview.get(name), name).not.toMatch(/(^|\s)\*(\s|$)/);
    }
  });

  it("sends no empty directive and no empty value", () => {
    for (const policy of [production, preview, development]) {
      for (const [name, values] of policy) {
        expect(name.length, "empty directive name").toBeGreaterThan(0);
        expect(values.length, `${name} has no value`).toBeGreaterThan(0);
      }
    }
  });

  it("only accepts same-origin form submissions", () => {
    for (const file of sourceFiles().filter((path) => !path.startsWith("src/test/"))) {
      for (const match of readFileSync(file, "utf8").matchAll(/action="([^"]*)"/g)) {
        expect(match[1], `${file} posts a form off-origin`).toMatch(/^\//);
      }
    }
  });
});

describe("embedded preview detection", () => {
  it("recognises the sandbox hosts", () => {
    expect(isEmbeddedPreviewHost("3000-abc.e2b.app")).toBe(true);
    expect(isEmbeddedPreviewHost("e2b.app")).toBe(true);
    expect(isEmbeddedPreviewHost("3000-abc.e2b.app:8443")).toBe(true);
  });

  it("does not match look-alike hosts", () => {
    expect(isEmbeddedPreviewHost("e2b.app.evil.com")).toBe(false);
    expect(isEmbeddedPreviewHost("evil-e2b.app")).toBe(false);
    expect(isEmbeddedPreviewHost("pryva.ng")).toBe(false);
    expect(isEmbeddedPreviewHost("")).toBe(false);
  });
});
