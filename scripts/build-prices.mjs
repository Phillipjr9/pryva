/**
 * Build the public price table from the supplier cost sheet.
 *
 * Why generate instead of computing in the app: `src/lib/catalog.ts` is imported
 * by client components, so anything it contains ships to the browser. Supplier
 * costs must not — they are our buying prices and they reveal the margin. The
 * cost sheet (`data/cost-sheet.json`) therefore stays server-side and this
 * script bakes the finished prices into `src/lib/prices.generated.ts`.
 *
 * Run:   npm run pricing:build      (regenerate prices)
 *        npm run pricing:audit      (print the margin table, generate nothing)
 *
 * A test (`src/test/profit-band.test.ts`) fails if the generated file is stale,
 * so a cost edit cannot silently ship old prices.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { priceFromCost, maxDiscountPercentFor, PROFIT_BAND } from "../src/lib/pricing.ts";

const SHEET = "data/cost-sheet.json";
const OUTPUT = "src/lib/prices.generated.ts";

const sheet = JSON.parse(readFileSync(SHEET, "utf8"));

/** @typedef {{ service: string, label: string, cost: number }} CostRow */

const rows = [];
const catalog = {};
const digital = {};

for (const [slug, row] of Object.entries(sheet.catalog)) {
  const quote = priceFromCost(row.cost, { service: row.service });
  catalog[slug] = {
    price: quote.priceNgn,
    maxDiscountPercent: maxDiscountPercentFor(quote.priceNgn, quote.costNgn),
  };
  rows.push({ kind: "catalog", id: slug, service: row.service, label: row.label, ...quote });
}

for (const [id, row] of Object.entries(sheet.digital)) {
  const quote = priceFromCost(row.cost, { service: row.service });
  digital[id] = {
    price: quote.priceNgn,
    maxDiscountPercent: maxDiscountPercentFor(quote.priceNgn, quote.costNgn),
  };
  rows.push({ kind: "digital", id, service: row.service, label: row.label, ...quote });
}

const outOfBand = rows.filter(
  (r) => r.markupPercent < PROFIT_BAND.min || r.markupPercent > PROFIT_BAND.max,
);

if (process.argv.includes("--audit")) {
  const fmt = (n) => `₦${n.toLocaleString("en-NG")}`;
  const pad = (s, n) => String(s).padEnd(n);
  console.log(
    pad("id", 20) + pad("service", 12) + pad("cost", 12) + pad("price", 12) + pad("profit", 12) + "markup",
  );
  for (const r of rows) {
    console.log(
      pad(r.id, 20) +
        pad(r.service, 12) +
        pad(fmt(r.costNgn), 12) +
        pad(fmt(r.priceNgn), 12) +
        pad(fmt(r.profitNgn), 12) +
        `${r.markupPercent}%`,
    );
  }
  const cheapest = [...rows].sort((a, b) => a.profitNgn - b.profitNgn)[0];
  console.log(
    `\n${rows.length} plans · band ${PROFIT_BAND.min}–${PROFIT_BAND.max}% · ` +
      `thinnest margin ${cheapest.profitNgn} on ${cheapest.id}`,
  );
  console.log(outOfBand.length === 0 ? "All prices inside the band ✓" : `${outOfBand.length} OUT OF BAND`);
  // The exit status is the verdict. Setting `process.exitCode = 1` and then
  // calling `process.exit(0)` discards it, which made `--check` exit successfully
  // while printing "OUT OF BAND" — a gate that could never fail.
  if (process.argv.includes("--check") && outOfBand.length > 0) process.exit(1);
  process.exit(0);
}

const header = `/**
 * GENERATED FILE — do not edit.
 *
 * Produced by \`scripts/build-prices.mjs\` from \`data/cost-sheet.json\`.
 * Change a cost there and run \`npm run pricing:build\`.
 *
 * Prices only: costs are deliberately absent from this file so they never
 * reach the browser bundle.
 */

export type GeneratedPrice = {
  /** Selling price in naira (cost + 30–50% markup, rounded to the step). */
  price: number;
  /** Largest discount percentage that still clears the 30% floor. */
  maxDiscountPercent: number;
};

`;

const body =
  `export const CATALOG_PRICES: Record<string, GeneratedPrice> = ${JSON.stringify(catalog, null, 2)};\n\n` +
  `export const DIGITAL_PRICES: Record<string, GeneratedPrice> = ${JSON.stringify(digital, null, 2)};\n`;

writeFileSync(OUTPUT, header + body);

if (outOfBand.length > 0) {
  console.error(`✗ ${outOfBand.length} price(s) outside the ${PROFIT_BAND.min}–${PROFIT_BAND.max}% band:`);
  for (const r of outOfBand) console.error(`  ${r.id}: ${r.markupPercent}%`);
  process.exitCode = 1;
} else {
  const thinnest = rows.reduce((a, b) => (a.profitNgn <= b.profitNgn ? a : b));
  console.log(
    `✓ ${rows.length} prices generated · band ${PROFIT_BAND.min}–${PROFIT_BAND.max}% · ` +
      `thinnest profit ₦${thinnest.profitNgn} (${thinnest.id}, ${thinnest.markupPercent}%) · ` +
      `total profit per unit-sale ₦${rows.reduce((sum, r) => sum + r.profitNgn, 0).toLocaleString("en-NG")}`,
  );
}
