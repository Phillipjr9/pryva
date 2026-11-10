import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function components(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? components(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

describe("shared typography", () => {
  it("uses the common scale for body-sized arbitrary text across app and components", () => {
    const scale = new Set([0.8125, 0.875, 0.9375, 1, 1.125, 1.25]);
    for (const file of [...components("src/app"), ...components("src/components")]) {
      for (const match of readFileSync(file, "utf8").matchAll(/text-\[((?:0?\.\d+|1(?:\.\d+)?))rem\]/g)) {
        const size = Number(match[1]);
        if (size >= 0.8 && size <= 1.2) expect(scale.has(size), `${file}: ${match[0]}`).toBe(true);
      }
    }
  });

  it("keeps the variable font self-hosted, with weights and naira character coverage", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    const font = readFileSync("node_modules/@fontsource-variable/plus-jakarta-sans/index.css", "utf8");
    const globals = readFileSync("src/app/globals.css", "utf8");
    const admin = readFileSync("src/styles/admin-console.css", "utf8");
    expect(layout).toContain('@fontsource-variable/plus-jakarta-sans');
    expect(font).toContain("font-weight: 200 800");
    expect(font).toContain("U+20A0-20AB"); // includes ₦ (U+20A6)
    expect(globals).toContain('"Plus Jakarta Sans Variable"');
    expect(admin).toContain('"Plus Jakarta Sans Variable"');
    expect(globals).toContain("-webkit-text-size-adjust: 100%");
    expect(globals).toContain("font-size: 16px;"); // prevents iOS input zoom
  });
});
