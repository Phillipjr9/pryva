import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SECURITY_CONTROLS } from "@/lib/security-controls";

/**
 * The table behind the security page's controls panel.
 *
 * Every row here is something the owner reads as fact, and the row that matters is
 * `state: "enforced"`. Five of the eight controls the page used to show as "Active"
 * are browser detectors in `lib/protection.ts`, which nothing imports -- so the page
 * asserted detections that have never run. The panel is now pinned to the filesystem
 * instead: a control may only be called enforced if its enforcement is reachable, and
 * if anybody ever installs the hook, the first test below fails and says the table
 * has to be updated. That is the point.
 */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = `${dir}/${entry}`;
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(path) ? [path] : [];
  });
}

const appFiles = sourceFiles("src/app");
const libFiles = sourceFiles("src/lib");
const componentFiles = sourceFiles("src/components");
const allFiles = [...appFiles, ...libFiles, ...componentFiles];

/** Entry points are not imported by anything; they run because the framework calls them. */
function isEntryPoint(file: string): boolean {
  return /\/(route|page)\.tsx?$/.test(file) || file === "src/proxy.ts";
}

function importersOf(module: string): string[] {
  const pattern = `from "${module}"`;
  return allFiles.filter(
    (file) => !file.endsWith(`${module}.ts`) && !file.endsWith(`${module}.tsx`) && readFileSync(file, "utf8").includes(pattern),
  );
}

describe("the security controls table", () => {
  it("marks the client detectors as not running, because nothing installs them", () => {
    // `lib/protection.ts` is the only way into the anti-reverse-engineering code, and it is the
    // only thing in the app that would ever call `/api/security/report`. Neither has an importer.
    expect(importersOf("@/lib/protection")).toEqual([]);
    expect(importersOf("./anti-reverse-engineering")).toEqual(["src/lib/protection.ts"]);
    expect(
      SECURITY_CONTROLS.filter((control) => control.source === "src/lib/protection.ts").map((control) => control.state),
    ).not.toContain("enforced");
  });

  it("claims nothing is enforced that no live path reaches", () => {
    const unreachable = SECURITY_CONTROLS.filter((control) => {
      if (control.state !== "enforced") return false;
      if (!existsSync(control.source)) return true;
      if (isEntryPoint(control.source)) return false;
      const stem = control.source.replace(/^src\//, "").replace(/\.tsx?$/, "");
      return !allFiles.some((file) => file !== control.source && readFileSync(file, "utf8").includes(stem));
    });
    expect(unreachable.map((control) => `${control.id} (${control.source})`)).toEqual([]);
  });

  it("names a source file for every row, so each claim can be checked", () => {
    for (const control of SECURITY_CONTROLS) {
      expect(control.source, control.id).toMatch(/^src\/[\w./-]+\.tsx?$/);
      expect(existsSync(control.source), control.source).toBe(true);
    }
  });

  it("does not let the dashboard state a control's status again", () => {
    // Eight rows of `enabled={true}` were the bug: the panel asserted itself, whatever the
    // code did. The states live in the table, and the page renders them.
    const dashboard = readFileSync("src/app/admin/security/SecurityDashboard.tsx", "utf8");
    expect(dashboard).not.toContain("enabled={true}");
    expect(dashboard).not.toContain("Active Protections");
    expect(dashboard).not.toContain("ProtectionStatus");
  });
});
