/**
 * Re-extracts the catalogue glyphs in `src/components/icons.tsx` from Lucide.
 *
 * Run:
 *   npm i --no-save lucide-static
 *   node scripts/extract-catalogue-icons.mjs
 *
 * Why this exists: these nine shapes were briefly drawn by hand, which is the
 * same mistake as generating them — nobody can tell a hand-wobbled gamepad from
 * an official one until it sits next to the real set and looks wrong. They are
 * now copied verbatim from `lucide-static` (ISC; some icons MIT via Feather), so
 * the geometry is a professional set's and an upgrade is reproducible.
 *
 * The script rewrites the marked block at the end of icons.tsx and nothing else.
 * `base()` still supplies the house 1.6 stroke weight, so only geometry comes
 * from upstream.
 *
 * Licence text lives at src/components/Lucide-LICENSE.txt.
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../package.json", import.meta.url));
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Exported name -> upstream Lucide slug. Order is the order in the file. */
const ICONS = [
  ["Music", "music"],
  ["Gamepad", "gamepad-2"],
  ["Layers", "layers"],
  ["Inbox", "inbox"],
  ["ShieldCheck", "shield-check"],
  ["Signal", "signal"],
  ["Megaphone", "megaphone"],
  ["IdCard", "id-card"],
  ["MonitorPlay", "monitor-play"],
];

const START = "/**\n * Catalogue glyphs — official Lucide path data, not hand-drawn.";

const iconsDir = join(dirname(require.resolve("lucide-static/package.json")), "icons");
const version = require("lucide-static/package.json").version;

/** The inner shapes of an upstream SVG, one per line, trimmed. */
function shapesFor(slug) {
  const svg = readFileSync(join(iconsDir, `${slug}.svg`), "utf8");
  const open = svg.indexOf(">", svg.indexOf("<svg"));
  const inner = svg.slice(open + 1, svg.lastIndexOf("</svg>"));
  const lines = inner.split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error(`lucide/${slug} has no shapes`);
  // Guard against upstream ever shipping something that is not a plain shape.
  for (const line of lines) {
    if (!/^<(path|circle|rect|line|polyline|polygon|ellipse)\b[^>]*\/>$/.test(line)) {
      throw new Error(`lucide/${slug} shipped unexpected markup: ${line}`);
    }
  }
  return lines;
}

let block = `/**
 * Catalogue glyphs — official Lucide path data, not hand-drawn.
 *
 * Extracted verbatim from \`lucide-static\` v${version} (ISC licence), the same
 * lineage as the rest of this file. Do not edit the shape data by eye and do not
 * generate it: re-extract it from the package so an upgrade stays reproducible.
 *
 * They render through \`base()\`, so the house keeps its 1.6 stroke weight while
 * the geometry stays exactly what upstream ships.
 *
 * Source: https://lucide.dev — ISC, attribution-free for commercial use.
 */

`;

for (const [name, slug] of ICONS) {
  block += `/** lucide \`${slug}\` */\nexport function ${name}(props: IconProps) {\n  return (\n    <svg {...base(props)}>\n`;
  for (const line of shapesFor(slug)) block += `      ${line}\n`;
  block += `    </svg>\n  );\n}\n\n`;
}

const target = join(root, "src/components/icons.tsx");
const source = readFileSync(target, "utf8");
const at = source.indexOf(START);
if (at === -1) throw new Error("catalogue block marker not found in icons.tsx");

writeFileSync(target, source.slice(0, at) + block.trimEnd() + "\n");
console.log(`Wrote ${ICONS.length} icons from lucide-static v${version}.`);
