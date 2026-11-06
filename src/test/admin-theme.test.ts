import { readFileSync } from "node:fs";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

/** AdminLTE must not leak its Bootstrap reset/components into the storefront. */
describe("the scoped AdminLTE theme", () => {
  const css = readFileSync("src/styles/adminlte.generated.css", "utf8");
  it("roots every document selector at the admin boundary", () => {
    const root = postcss.parse(css);
    const unscoped: string[] = [];
    root.walkRules((rule) => {
      if (/keyframes$/i.test(rule.parent?.type === "atrule" ? rule.parent.name : "")) return;
      for (const selector of rule.selectors) if (!selector.startsWith(".admin-app")) unscoped.push(selector);
    });
    expect(unscoped).toEqual([]);
    expect(css).toContain("Pryva console overrides");
  });
  it("keeps the upstream MIT license alongside the generated stylesheet", () => {
    expect(readFileSync("src/styles/AdminLTE-LICENSE.txt", "utf8")).toContain("The MIT License");
  });
});
