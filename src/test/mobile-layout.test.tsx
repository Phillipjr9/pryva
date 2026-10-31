import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { viewport } from "@/app/layout";

/**
 * Reading the site on a phone.
 *
 * Reported: "when using mobile phone with different screen size user will have
 * to adjust the screen zoom". Three separate causes, all of them invisible on a
 * desktop and none of them caught by a rendering test:
 *
 *   1. 369 separate `text-[0.5…0.79rem]` declarations, down to 9.3 px, so the
 *      small print had to be pinched open to be read;
 *   2. form controls at 14.7 px, which makes iOS Safari zoom the whole page in
 *      on focus and leave it zoomed;
 *   3. tables wrapped in `overflow-hidden`, which clipped the right-hand columns
 *      on a narrow screen instead of letting them scroll.
 *
 * These assertions are on the source and on the declared viewport, because the
 * failures are only visible in a browser at 320–430 px, which this suite does
 * not have.
 */

const SOURCES = [
  "src/app",
  "src/components",
];

function walk(dir: string, out: string[] = []): string[] {
  const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
  for (const entry of readdirSync(dir)) {
    const path = `${dir}/${entry}`;
    if (statSync(path).isDirectory()) {
      if (entry === "test") continue;
      walk(path, out);
    } else if (path.endsWith(".tsx") || path.endsWith(".ts")) {
      out.push(path);
    }
  }
  return out;
}

const files = SOURCES.flatMap((dir) => walk(dir));
const css = readFileSync("src/app/globals.css", "utf8");

describe("phone legibility", () => {
  it("has no text smaller than the phone floor left in the components", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      // Only sizes that apply on a phone: `sm:text-[0.68rem]` and
      // `sm:!text-[0.78rem]` are desktop overrides and are fine; an unprefixed
      // `text-[0.68rem]` (optionally `!`-important) is not.
      for (const match of source.matchAll(/([\w-]+:)?!?text-\[(0?\.\d+)rem\]/g)) {
        if (match[1]) continue;
        if (Number(match[2]) < 0.8) offenders.push(`${file}: ${match[0]}`);
      }
    }

    expect(offenders, `small text came back:\n${offenders.join("\n")}`).toHaveLength(0);
  });

  it("defines the two small steps with a floor below the sm breakpoint", () => {
    for (const step of ["text-micro", "text-meta"]) {
      expect(css).toContain(`.${step} {`);
    }

    // The mobile floor lives in one media query, so both steps rise together.
    const mobile = css.slice(css.indexOf("@media (max-width: 639px)"));
    expect(mobile).toContain(".text-micro,\n    .text-meta {");
    expect(mobile).toContain("font-size: 0.8125rem;"); // 13px
  });

  it("puts form controls at 16px on a phone so iOS stops zooming on focus", () => {
    // The threshold is 16px: one pixel under and Safari zooms the page in and
    // never zooms back out. `.field` is 0.92rem, so this rule is the fix.
    const mobile = css.slice(css.indexOf("input:not([type=\"checkbox\"])"));
    expect(mobile).toBeTruthy();
    expect(css).toContain("input:not([type=\"checkbox\"]):not([type=\"radio\"]):not([type=\"range\"])");
    expect(css).toContain("      font-size: 16px;");
  });

  it("keeps a sideways guard on the page without breaking sticky elements", () => {
    // `clip` (not `hidden`): it stops a stray decorative blur from adding a
    // horizontal scrollbar without creating a scroll container, which would
    // break the sticky header and the fixed tab bar.
    expect(css).toContain("overflow-x: clip;");
    expect(css).not.toContain("overflow-x: hidden;");
  });

  it("stops iOS inflating type when the device is rotated", () => {
    expect(css).toContain("-webkit-text-size-adjust: 100%;");
    expect(css).toContain("text-size-adjust: 100%;");
  });
});

describe("mobile viewport", () => {
  it("lays out at the device width and does not disable zoom", () => {
    expect(viewport.width).toBe("device-width");
    expect(viewport.initialScale).toBe(1);
    // Turning zoom off is the standard way a "fix" makes a page unusable for
    // the people who need it, so its absence is asserted, not assumed.
    expect(viewport.maximumScale).toBeUndefined();
    expect(viewport.userScalable).toBeUndefined();
  });

  it("covers the notch and keeps light form controls", () => {
    expect(viewport.viewportFit).toBe("cover");
    expect(viewport.colorScheme).toBe("light");
  });
});

describe("tables on a narrow screen", () => {
  it("never clips a table instead of scrolling it", () => {
    // `overflow-hidden` was used to round the corners, which also cut off the
    // last columns — data a customer cannot reach at all.
    const offenders = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      // Tolerates a JSX comment between the wrapper and the table, which is
      // exactly where the explanation for the fix tends to go.
      return /overflow-hidden[^"]*"\s*>\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<table/.test(source);
    });

    expect(offenders, `clipped tables:\n${offenders.join("\n")}`).toHaveLength(0);
  });

  it("gives every table a scroll container", () => {
    const offenders = files
      .filter((file) => !file.includes("email-templates"))
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return source.includes("<table") && !source.includes("overflow-x-auto");
      });

    expect(offenders, `tables without a scroll container:\n${offenders.join("\n")}`).toHaveLength(0);
  });
});

describe("responsive overflow regressions", () => {
  it("lets flex and grid children shrink instead of imposing min-content widths", () => {
    expect(css).toContain(":where(.flex, .inline-flex, .grid) > * {");
    expect(css).toContain("overflow-wrap: anywhere;");
  });

  it("keeps iOS input sizes above the zoom threshold even with text utilities or CSS modules", () => {
    const rule = css.slice(css.lastIndexOf("@media"));
    expect(rule).toContain("(max-width: 1023px), (pointer: coarse)");
    expect(rule).toContain("font-size: max(1rem, 16px) !important;");
  });

  it("allows dashboard header actions to wrap on narrow screens", () => {
    const shell = readFileSync("src/components/dashboard/DashboardShell.tsx", "utf8");
    expect(shell).toContain("mb-4 flex flex-wrap items-center justify-between");
    expect(shell).toContain("flex min-w-0 max-w-full flex-wrap items-center gap-1.5");
  });
});
