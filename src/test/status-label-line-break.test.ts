import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const css = readFileSync(join(root, "app/globals.css"), "utf8");
const orders = readFileSync(join(root, "app/dashboard/orders/page.tsx"), "utf8");

/**
 * Short labels that broke mid-word.
 *
 * A screenshot of the orders table at 1440px showed the status pill rendering
 * "Acti/ve". Two rules combined to produce it: the base `:where(.flex,
 * .inline-flex, .grid) > * { min-width: 0 }` lets a grid column shrink below
 * its content, and `overflow-wrap: anywhere` on the body makes breaking a word
 * legal at *any* character — including inside `white-space: nowrap`.
 * `break-word` breaks only as a last resort and is not considered for
 * min-content sizing, which is what these columns need.
 */
describe("status labels stay on one line", () => {
  it("does not set the whole page to break anywhere", () => {
    const body = css.slice(css.indexOf("body {"), css.indexOf("}", css.indexOf("body {")));
    expect(body).toContain("overflow-wrap: break-word");
    expect(body).not.toContain("overflow-wrap: anywhere");
  });

  it("keeps the opt-in break for the places that need it", () => {
    // Buttons wrap their own label onto two lines instead of overflowing; the
    // inbox renders addresses and codes that can be longer than a phone.
    expect(css).toMatch(/\.btn\s*{[^}]*overflow-wrap: anywhere/);
    expect(readFileSync(join(root, "app/dashboard/inbox/InboxManager.tsx"), "utf8")).toContain(
      "[overflow-wrap:anywhere]",
    );
  });

  it("pins the orders status pill and its neighbours", () => {
    const pill = orders.match(/inline-flex w-fit items-center[^"]*capitalize/)?.[0] ?? "";
    expect(pill, "status pill should carry whitespace-nowrap").toContain("whitespace-nowrap");
    expect(orders).toContain('gap-1 whitespace-nowrap rounded-full bg-lav-50 px-2 py-1 text-micro font-semibold text-lav-700');
    expect(orders).toContain("whitespace-nowrap rounded-full border px-3 py-1.5 text-meta");
  });

  it("gives the status column enough room for the longest label", () => {
    // "processing" is the widest status, and nowrap means it now claims its full
    // width instead of folding. The template is shared by the header and every row.
    const columns = [...orders.matchAll(/grid-cols-\[([\d.]+fr_[\d.]+fr_[\d.]+fr_[\d.]+fr_[\d.]+fr)\]/g)].map((m) => m[1]);
    expect(columns.length).toBeGreaterThan(1);
    for (const template of columns) {
      const parts = template.split("_").map((track) => Number(track.replace("fr", "")));
      expect(parts[3], "status column should be at least 0.7fr").toBeGreaterThanOrEqual(0.7);
    }
  });
});
