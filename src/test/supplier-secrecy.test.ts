import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";

// The hand-prepared lane is closed in the in-memory preview (it would publish
// stock the demo cannot deliver), so open it here to inspect what it exposes.
vi.mock("@/lib/demo-policy", () => ({ isPreviewDatabase: () => false }));

/**
 * The owner's rule: no customer ever learns where a product comes from.
 *
 * Not in copy, not in an error message, not in a dashboard banner, not in a JSON
 * field a shopper can read in devtools, and not in a committed data file they
 * could find — the repository is public.
 *
 * Two separate scans, because they fail differently:
 *
 *  • VENDORS are names. They may appear in the server-only adapters that call
 *    those APIs (unavoidable: the base URL has to live somewhere), but never in
 *    anything a customer reads.
 *  • DISCLOSURE words are not names, but they still tell a customer that Pryva
 *    buys its stock elsewhere. Those are banned from customer-facing copy too.
 *    Internal code identifiers and comments are excluded on purpose — `provider
 *    === "fleexa"` is a routing key, not a sentence anybody reads.
 */
const VENDORS = ["fleexa", "accszone", "bulkacc", "freshbulkacc", "resellacc", "accsbulk", "bitcall"];
const DISCLOSURE = [
  "reseller", "resell", "wholesale", "upstream", "vendor", "dropship", "drop-ship",
  // Every inflection, not just the noun: "supplier" alone let "delivered exactly
  // as supplied" and "our supply partners" render on customer-facing pages.
  "supplier", "supplied", "supplies", "supplying", "supply",
  // Sourcing phrased as an action rather than a role.
  "sourced from", "source of our", "procured", "stockist", "distributor",
];

/**
 * Marketing surfaces plus the catalogue copy that renders on them, and the
 * dashboard components whose *strings* reach a signed-in customer.
 */
const USER_FACING = [
  "src/app/(site)",
  "src/app/(auth)",
  "src/app/dashboard",
  "src/components/site",
  "src/components/dashboard",
  "src/lib/catalog.ts",
  "src/lib/digital-services.ts",
  "src/lib/service-explorer.ts",
  "src/lib/warranty.ts",
];

/**
 * Everything under `src` that starts with `"use client"` is bundled and shipped
 * to the browser, where a shopper can read it in devtools or in the built chunk.
 * A vendor name there is a leak even if no component ever renders it — which is
 * exactly how `provider === "fleexa"` survived in the order screen.
 */
function clientComponents(): string[] {
  const root = path.join(process.cwd(), "src");
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(full) && readFileSync(full, "utf8").trimStart().startsWith('"use client"')) found.push(full);
    }
  };
  walk(root);
  return found;
}

/** Committed data files are public: no names, and no wholesale cost per item. */
const COMMITTED_DATA = ["data/manual-catalog.json"];

function walk(dir: string, files: string[] = []): string[] {
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.(ts|tsx)$/.test(full)) files.push(full);
  }
  return files;
}

function sourceFiles(target: string): string[] {
  const full = path.join(process.cwd(), target);
  return target.endsWith(".ts") || target.endsWith(".tsx") ? [full] : walk(full);
}

/** Strip block and line comments: internal notes may name a vendor. */
function withoutComments(contents: string): string {
  return contents
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "");
}

function offenders(targets: string[], words: string[], stripComments: boolean): string[] {
  const found: string[] = [];
  for (const target of targets) {
    for (const file of sourceFiles(target)) {
      const contents = readFileSync(file, "utf8");
      const haystack = (stripComments ? withoutComments(contents) : contents).toLowerCase();
      if (words.some((word) => haystack.includes(word))) {
        found.push(path.relative(process.cwd(), file));
      }
    }
  }
  return found;
}

describe("supplier secrecy", () => {
  it("never names a source in user-facing files", () => {
    expect(offenders(USER_FACING, VENDORS, true)).toEqual([]);
  });

  it("never tells a customer that stock is bought in from elsewhere", () => {
    // Comments are stripped, so an engineering note about a supplier's rate limit
    // is fine; a rendered sentence about "supplier inventory" is not.
    expect(offenders(USER_FACING, DISCLOSURE, true)).toEqual([]);
  });

  it("never ships a source name or sourcing language inside a client bundle", () => {
    const components = clientComponents();
    expect(components.length).toBeGreaterThan(20); // the scan really walked the tree

    // Both lists matter here. A name is an obvious leak, but so is an
    // admin-only placeholder reading "out of stock upstream": the built chunk is
    // served to anyone who asks for it, authenticated or not.
    const banned = [...VENDORS, ...DISCLOSURE];
    const leaking: string[] = [];
    for (const file of components) {
      const haystack = withoutComments(readFileSync(file, "utf8")).toLowerCase();
      for (const word of banned) {
        if (haystack.includes(word)) leaking.push(`${path.relative(process.cwd(), file)}: ${word}`);
      }
    }
    expect(leaking).toEqual([]);
  });

  it("keeps sourcing out of committed data files", () => {
    for (const target of COMMITTED_DATA) {
      const contents = readFileSync(path.join(process.cwd(), target), "utf8").toLowerCase();
      for (const word of [...VENDORS, ...DISCLOSURE]) {
        expect(contents, `${target} mentions "${word}"`).not.toContain(word);
      }
      for (const url of ["http://", "https://", ".com", ".ng"]) {
        expect(contents, `${target} contains a link (${url})`).not.toContain(url);
      }
    }
  });

  it("keeps the hand-prepared catalog's private fields out of the sellable shape", async () => {
    const { getManualProduct } = await import("@/lib/manual-catalog");
    const product = getManualProduct("p3:netflix-standard");
    expect(product).not.toBeNull();
    const haystack = JSON.stringify(product).toLowerCase();
    for (const word of [...VENDORS, ...DISCLOSURE]) {
      expect(haystack, `listing leaked "${word}"`).not.toContain(word);
    }
    // Wholesale cost stays server-side: it is what we pay, never what we charge.
    expect(Object.keys(product as object)).not.toContain("note");
  });
});
