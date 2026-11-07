import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Where the catalogue glyphs come from.
 *
 * The owner's instruction was "real icons, not AI-generated". Nine of these
 * shapes had been drawn by hand for the flat-icon pass, which is the same
 * problem in a different costume: an invented gamepad is still an invented
 * gamepad. They are now copied verbatim from `lucide-static`, and this file is
 * what keeps them that way — it compares the committed markup against the
 * package on every run, so a hand-tweak or a regenerated shape fails here
 * instead of shipping.
 *
 * Re-extract with `npm run icons:extract`. Licence: src/components/Lucide-LICENSE.txt.
 */

const require = createRequire(import.meta.url);
const ICONS: Array<[string, string]> = [
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

const source = readFileSync("src/components/icons.tsx", "utf8");
const iconsDir = join(dirname(require.resolve("lucide-static/package.json")), "icons");

/** The shape elements of some markup, whitespace-normalised. */
function shapes(markup: string): string[] {
  return [...markup.matchAll(/<(path|circle|rect|line|polyline|polygon|ellipse)\b[^>]*\/>/g)].map((m) =>
    m[0].replace(/\s+/g, " ").trim(),
  );
}

describe("catalogue icon provenance", () => {
  it.each(ICONS)("%s is verbatim lucide/%s", (name, slug) => {
    const body = source.split(`export function ${name}(`)[1];
    expect(body, `${name} is not exported from icons.tsx`).toBeTruthy();
    const ours = shapes(body.slice(0, body.indexOf("</svg>")));
    const upstream = shapes(readFileSync(join(iconsDir, `${slug}.svg`), "utf8"));

    expect(ours.length, `${name} draws nothing`).toBeGreaterThan(0);
    expect(ours, `${name} was edited by hand — run npm run icons:extract`).toEqual(upstream);
  });

  it("ships the upstream licence", () => {
    const licence = readFileSync("src/components/Lucide-LICENSE.txt", "utf8");
    expect(licence).toContain("ISC License");
    expect(licence).toContain("Lucide Icons and Contributors");
    // `music` is one of the icons Lucide derives from Feather, so the MIT
    // notice has to travel with it too.
    expect(licence).toContain("Feather");
    expect(licence).toContain("The MIT License (MIT)");
  });

  it("keeps the extraction reproducible", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.scripts["icons:extract"]).toBe("node scripts/extract-catalogue-icons.mjs");
    expect(pkg.devDependencies["lucide-static"], "pin the version so shapes cannot drift").toMatch(/^\d+\.\d+\.\d+$/);
  });
});
