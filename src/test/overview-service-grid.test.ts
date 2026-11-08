import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(process.cwd(), "src");
const overview = readFileSync(join(root, "app/dashboard/page.tsx"), "utf8");

/**
 * The "Select a service" hub at desktop width.
 *
 * Captured at 1440px: the tiles read "Nu…", "Single+…", "Soc…" — the shortcuts
 * were unusable on the largest screens and perfectly legible on a phone, which
 * is the opposite of what a responsive grid is supposed to do. The tiles go
 * two-up at `sm` because that is when each one has room to be a full row, but
 * from `lg` the panel is the *narrow* right-hand column of the overview grid
 * (0.75fr of ~1100px ≈ 330px), so two-up puts each tile at ~160px and the
 * labels truncate.
 */
describe("overview service hub", () => {
  const grid = overview.match(/className="mt-3 grid[^"]*"/)?.[0] ?? "";

  it("keeps quick actions balanced on a phone and stacks to one column on the wide sidebar", () => {
    expect(grid).toContain("grid-cols-2");
    expect(grid).toContain("sm:grid-cols-2");
    expect(grid).toContain("lg:grid-cols-1");
  });

  it("applies the single-column rule after the phone-friendly two-up layout", () => {
    expect(grid.indexOf("sm:grid-cols-2")).toBeLessThan(grid.indexOf("lg:grid-cols-1"));
  });

  it("is the section that sits in the narrow column", () => {
    expect(overview).toContain("lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.75fr)]");
    const section = overview.slice(overview.indexOf('aria-labelledby="select-service-title"'));
    expect(section.slice(0, 200)).toContain("lg:order-2");
  });

  it("keeps the labels short enough to survive a truncate", () => {
    // The longest one decides whether a row needs the whole column.
    const tileLabels = [...overview.matchAll(/\{ label: "([^"]+)", note:/g)].map((m) => m[1]);
    expect(tileLabels.length).toBeGreaterThanOrEqual(8);
    const longest = tileLabels.reduce((a, b) => (b.length > a.length ? b : a), "");
    expect(longest.length, `longest tile label "${longest}"`).toBeLessThanOrEqual(20);
  });
});
