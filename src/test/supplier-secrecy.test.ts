import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

/**
 * The owner's rule: no supplier name reaches a customer. Not in copy, not in an
 * error message, not in a dashboard banner. API routes stay neutral
 * (`/api/accounts/*`), and the vendor names live only in the client/adapters.
 */
const VENDORS = ["fleexa", "accszone"];

/**
 * Marketing surfaces plus the catalogue copy that renders on them. Dashboard
 * components are excluded on purpose: `provider === "fleexa"` is a routing key,
 * not a sentence a customer reads.
 */
const USER_FACING = [
  "src/app/(site)",
  "src/components/site",
  "src/lib/catalog.ts",
  "src/lib/digital-services.ts",
];

function walk(dir: string, files: string[] = []): string[] {
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, files);
    else if (/\.(ts|tsx)$/.test(full)) files.push(full);
  }
  return files;
}

describe("supplier secrecy", () => {
  it("never names a supplier in user-facing files", () => {
    const offenders: string[] = [];

    for (const target of USER_FACING) {
      const full = path.join(process.cwd(), target);
      const files = target.endsWith(".ts") ? [full] : walk(full);
      for (const file of files) {
        const contents = readFileSync(file, "utf8");
        // Strip block/line comments: internal notes may name the vendor.
        const withoutComments = contents
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|\s)\/\/.*$/gm, "");
        const lower = withoutComments.toLowerCase();
        if (VENDORS.some((vendor) => lower.includes(vendor))) {
          offenders.push(path.relative(process.cwd(), file));
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
