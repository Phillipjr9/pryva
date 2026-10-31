/**
 * Generates the small WebP derivatives the UI actually downloads.
 *
 * Why this exists: `next.config.ts` sets `images.unoptimized: true`, so every
 * `<Image>` served the full-size master. The nine 3D service icons are 512×512
 * PNGs of 220–270 KB each, drawn into slots between 20 px and 64 px — 2,197 KB
 * of bytes to paint nine thumbnails on the busiest page on the site. The
 * masters stay exactly as they are (they are the source of truth and the
 * fallback), and this script writes 64/128/192 px WebP copies next to them.
 *
 * Run after changing any master artwork:
 *   npm run artwork:build
 *
 * The derivatives are committed, so a deploy never depends on this having run.
 * Never edit a derivative by hand — regenerate it.
 */
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

/** 64 px covers 1× at the largest slot (lg = 64); 128/192 cover 2× and 3×. */
export const WIDTHS = [64, 128, 192];

const TARGETS = [
  { dir: "public/images/services", label: "service" },
  { dir: "public/images/categories", label: "category" },
  // The dashboard's own destinations (Overview, Orders, Wallet, Inbox,
  // Referrals, All services, Notifications, Reviews, Settings, Support).
  { dir: "public/images/nav", label: "nav" },
];

let totalIn = 0;
let totalOut = 0;
let written = 0;

for (const target of TARGETS) {
  const files = readdirSync(target.dir).filter((name) => name.endsWith(".png"));

  for (const file of files) {
    const input = join(target.dir, file);
    const base = file.replace(/\.png$/, "");
    totalIn += statSync(input).size;

    for (const width of WIDTHS) {
      const output = join(target.dir, `${base}-${width}.webp`);
      const buffer = await sharp(input)
        .resize(width, width, { fit: "cover" })
        .webp({ quality: 82, effort: 6 })
        .toBuffer();
      writeFileSync(output, buffer);
      totalOut += buffer.length;
      written += 1;
    }
  }
}

// A report, because "it looked fine" is how 270 KB icons survived this long.
const kb = (bytes) => Math.round(bytes / 1024);
console.log(`${written} WebP derivatives written`);
console.log(`masters: ${kb(totalIn)} KB · derivatives: ${kb(totalOut)} KB`);
console.log(`an <img> downloads one derivative, not the set — the 64 px copy is the common case`);
