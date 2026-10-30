import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const security = readFileSync("SECURITY.md", "utf8");
const securityTxt = readFileSync("public/.well-known/security.txt", "utf8");
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  overrides?: Record<string, string>;
};

/**
 * A security document is only worth having if it stays true, and a
 * `security.txt` is only worth having if it has not expired — an expiry date in
 * the past tells a researcher the file is abandoned, which is worse than no file.
 */
describe("security posture", () => {
  it("documents the threat model and the controls, in code terms", () => {
    for (const section of [
      "## 1. The threat model",
      "## 2. What is implemented, and where",
      "## 3. What this pass changed",
      "## 4. Known gaps",
      "## 5. The operator checklist",
      "## 6. Reporting a vulnerability",
    ]) {
      expect(security, section).toContain(section);
    }
    // Named files, so the document can be checked rather than believed.
    for (const file of [
      "src/lib/account-lockout.ts",
      "src/lib/admin-two-factor.ts",
      "src/lib/security-headers.ts",
      "src/lib/daily-reconciliation.ts",
      "src/lib/paystack-webhook.ts",
      "scripts/backup-db.mjs",
    ]) {
      expect(security, file).toContain(file);
    }
  });

  it("does not promise that the system cannot be hacked", () => {
    expect(security).toMatch(/No system is unhackable/i);
    // The one claim worth banning outright.
    expect(security.toLowerCase()).not.toContain("unhackable system");
    expect(security.toLowerCase()).not.toContain("100% secure");
  });

  it("lists the gaps rather than only the wins", () => {
    for (const gap of ["edge bot defence", "unsafe-inline", "penetration test", "DMARC"]) {
      expect(security.toLowerCase(), gap).toContain(gap.toLowerCase());
    }
    expect(security).toContain("ADMIN_2FA_REQUIRED=false");
  });

  it("pins the advisory that was reachable through the Vercel SDK", () => {
    expect(pkg.overrides?.zod).toBeTruthy();
    expect(pkg.overrides?.zod).toMatch(/4\.6\./);
  });

  it("gates production advisories in CI", () => {
    expect(ci).toContain("npm audit --omit=dev --audit-level=high");
  });

  it("publishes a security contact that has not expired", () => {
    expect(securityTxt).toContain("Contact: https://pryva.ng/contact");
    expect(securityTxt).toContain("Canonical: https://pryva.ng/.well-known/security.txt");
    const expires = /Expires:\s*(\S+)/.exec(securityTxt)?.[1] ?? "";
    const when = Date.parse(expires);
    expect(Number.isFinite(when)).toBe(true);
    expect(when).toBeGreaterThan(Date.parse("2026-10-30"));
  });

  it("asks researchers not to attack real customers while proving a point", () => {
    expect(security).toMatch(/do not.*test against a live account/i);
    expect(security).toMatch(/automated\s+scanners/i);
  });
});
