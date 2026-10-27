import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function routeFiles(dir = "src/app/api"): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...routeFiles(full));
    else if (entry === "route.ts") out.push(full);
  }
  return out;
}

describe("api auth contract", () => {
  /**
   * `requireAuth()` calls `redirect()`, which throws NEXT_REDIRECT. In a route
   * handler that surfaces as a 500 (or a 307 to an HTML page for `fetch`
   * callers) instead of the 401 JSON clients can handle. This regression guard
   * keeps API routes on `requireAuthApi()`.
   */
  it("never calls the redirecting requireAuth from an API route", () => {
    const offenders = routeFiles().filter((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .some((line) => /\brequireAuth\(/.test(line)),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps protected endpoints answering 401-shaped JSON, not redirects", () => {
    const files = routeFiles().filter((file) => readFileSync(file, "utf8").includes("requireAuthApi()"));
    expect(files.length).toBeGreaterThan(15);
    for (const file of files) {
      expect(readFileSync(file, "utf8")).toMatch(/status:\s*401/);
    }
  });

  it("does not hand the whole API to every origin", () => {
    const proxy = readFileSync("src/proxy.ts", "utf8");
    expect(proxy).not.toContain('"Access-Control-Allow-Origin", "*"');
    expect(proxy).toContain('"Cache-Control", "no-store"');
  });
});
