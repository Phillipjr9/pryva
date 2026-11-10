/**
 * Audit customer-safe catalogue JSON saved from /api/services/catalog or
 * /api/services/digital-catalog. No supplier credentials or user sessions are
 * needed. Never interprets a recognised mapping as proof that its image loads
 * or that the mark belongs to the listing: both still need manual verification.
 *
 * Usage: node scripts/audit-service-artwork.mjs catalogue.json [more-pages.json ...]
 * Output contains listing names and artwork types only, never account IDs,
 * balances, prices, links, tokens, order information or the original JSON.
 */
import { readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_ITEMS = 100_000;
const MAX_LABEL = 160;
const RECOGNISED = new Set(["brand", "network", "site-favicon", "simple-icon", "verified-brand-logo"]);
const DIGITAL_KINDS = new Set(["local", "indexed", "category", "brand", "simple"]);

function clean(value, fallback) {
  return typeof value === "string" && value.trim()
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_LABEL)
    : fallback;
}

function artworkState(item) {
  const art = item.artwork;
  if (!art || typeof art !== "object" || Array.isArray(art)) return "missing or generic";
  if (art.kind === "digital-product") {
    return art.art && typeof art.art === "object" && DIGITAL_KINDS.has(art.art.kind)
      ? `mapped: digital ${art.art.kind}` : "missing or generic";
  }
  // Digital-catalog API returns a DigitalArtwork directly, unlike catalog API.
  if (DIGITAL_KINDS.has(art.kind) && typeof art.key === "string") return `mapped: digital ${art.kind}`;
  if (RECOGNISED.has(art.kind)) return `mapped: ${art.kind}`;
  return "missing or generic";
}

export function auditCatalogues(pages) {
  if (!Array.isArray(pages) || pages.length === 0) throw new Error("Provide at least one catalogue response.");
  const summary = Object.create(null), missing = new Map(), warnings = [];
  let total = 0;
  for (const page of pages) {
    if (!page || typeof page !== "object" || page.ok !== true || !Array.isArray(page.items)) {
      throw new Error("Each file must be a successful catalogue response with an items array.");
    }
    if (page.live === false) warnings.push("A live feed was unavailable; its inventory is not included.");
    if (page.partial === true || page.reason === "partial") warnings.push("A catalogue response was partial.");
    if (page.nextCursor) warnings.push("A digital catalogue page has a next cursor; further pages are not included.");
    if (page.searchLimited === true || page.skipped === true) warnings.push("A digital catalogue response was limited or skipped entries.");
    if (total + page.items.length > MAX_ITEMS) throw new Error("Too many listings in supplied responses.");
    for (const item of page.items) {
      if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.name !== "string" || !item.name.trim()) {
        throw new Error("A listing is missing its name; the audit cannot be complete.");
      }
      total++;
      const category = clean(item.category, "digital or unspecified");
      const state = artworkState(item);
      const key = `${category} | ${state}`;
      summary[key] = (summary[key] ?? 0) + 1;
      if (state === "missing or generic") {
        const name = clean(item.name, "Unnamed");
        const key = JSON.stringify([category, name]);
        const prior = missing.get(key);
        if (prior) prior.count++;
        else missing.set(key, { category, name, count: 1 });
      }
    }
  }
  return {
    disclaimer: "Only supplied rows were counted. Mapped artwork is not verified; images and brand identity must be checked separately. Duplicate listings across input pages may be counted more than once.",
    totalRows: total,
    warnings: [...new Set(warnings)],
    summary,
    missing: [...missing.values()].sort((a, b) => b.count - a.count || a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
  };
}

function main(files) {
  if (!files.length) throw new Error("Usage: node scripts/audit-service-artwork.mjs catalogue.json [more-pages.json ...]");
  const pages = files.map((file) => {
    if (statSync(file).size > MAX_FILE_BYTES) throw new Error("Catalogue file exceeds the 50 MB limit.");
    return JSON.parse(readFileSync(file, "utf8"));
  });
  console.log(JSON.stringify(auditCatalogues(pages), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    console.error(`Artwork audit failed: ${error instanceof Error ? error.message : "invalid input"}`);
    process.exitCode = 1;
  }
}
