import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const globals = readFileSync(join(root, "app/globals.css"), "utf8");

/** The `--color-*` scale declared in `@theme`, which every utility class reads from. */
function themeColours(): Record<string, string> {
  const start = globals.indexOf("@theme {");
  const block = globals.slice(start, globals.indexOf("\n}", start));
  return Object.fromEntries(
    [...block.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]),
  );
}

const colours = themeColours();

/** `globals.css` without its comments, so explanatory hex values are not read as declarations. */
const declarations = globals.replace(/\/\*[\s\S]*?\*\//g, "");

/** WCAG 2.1 relative luminance. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => {
    const c = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Contrast ratio between two hex colours, 1..21. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every app source file — the test directory is skipped so this file cannot flag itself. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "test") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

function rule(name: string): string {
  const start = declarations.indexOf(`${name} {`);
  return declarations.slice(start, declarations.indexOf("}", start));
}

describe("primary call-to-action contrast", () => {
  it("keeps white label text on the primary button at WCAG AA", () => {
    // This is the rule behind every `.btn.btn-primary` in the product.
    const token = rule(".btn-primary").match(/background:\s*var\(--color-([a-z0-9-]+)\)/);
    expect(token, "btn-primary should take its fill from a theme token").not.toBeNull();

    const ratio = contrast(colours[token![1]], "#ffffff");
    // 4.5:1 is the AA floor, and these labels are 0.9rem/600 — small text.
    expect(ratio, `white on --color-${token![1]} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });

  it("does not reintroduce the light purple gradient", () => {
    // The old fill ran #8b6fd1 -> #c0a8ee; its lightest stop measured 2.2:1.
    expect(rule(".btn-primary")).not.toContain("linear-gradient");
    for (const dead of ["#8b6fd1", "#a98ce0", "#c0a8ee"]) {
      expect(declarations.toLowerCase()).not.toContain(dead);
    }
  });

  it("never puts white text on a fill below the AA floor", () => {
    // lav-600 (#8266c9) is 4.47:1 under white — just short, and the obvious
    // "brand purple" to reach for, so it keeps coming back.
    const fails = new Set(
      Object.entries(colours)
        .filter(([, hex]) => contrast(hex, "#ffffff") < 4.5)
        .map(([name]) => name),
    );

    const offenders: string[] = [];
    for (const file of sources(root)) {
      const text = readFileSync(file, "utf8");
      text.split("\n").forEach((line, index) => {
        // A fill and `text-white` have to sit in the same run of class tokens to
        // be on the same element. Ternaries put several elements' classes on one
        // line, and a `hover:` fill is a transient state, not the resting colour.
        for (const run of line.match(/[a-z0-9:[\]_/.-]+(?: [a-z0-9:[\]_/.-]+)*/g) ?? []) {
          const tokens = run.split(" ");
          if (!tokens.some((t) => t === "text-white")) continue;
          const fill = tokens.find((t) => /^[a-z-]*bg-[a-z0-9-]+(?:-\d{2,3})?/.test(t) && !t.includes(":"));
          const shade = fill?.match(/^bg-([a-z0-9-]+)$/)?.[1];
          if (shade && fails.has(shade)) {
            offenders.push(`${file.replace(root, "")}:${index + 1} ${fill}`);
          }
        }
      });
    }

    expect(offenders).toEqual([]);
  });

  it("keeps muted body text readable on the cream background", () => {
    // ink-3 is the caption colour and ink-2 the secondary text colour.
    expect(contrast(colours["ink-3"], colours["cream"])).toBeGreaterThanOrEqual(4.5);
    expect(contrast(colours["ink-2"], colours["cream"])).toBeGreaterThanOrEqual(4.5);
  });
});
