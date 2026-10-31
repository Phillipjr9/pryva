import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { RETENTION_YEARS, isPastRetention, purgeDueAt, purgeEnabled, retentionCutoff } from "@/lib/retention";

/**
 * The ten-year horizon.
 *
 * Two things are being pinned here, and only one of them is arithmetic. The other
 * is the owner's decision that customers are **not told** how long the records are
 * kept, which makes "the number stays server-side" a requirement rather than a
 * preference — so the last cases check where it is allowed to appear.
 *
 * The destructive half lives in `financial-auth-integration.test.ts`, against real
 * PostgreSQL, because a purge is not something to trust to a mock.
 */

const read = (path: string) => readFileSync(path, "utf8");
const NOW = new Date("2026-10-31T12:00:00.000Z");

describe("the horizon", () => {
  it("is ten years", () => {
    expect(RETENTION_YEARS).toBe(10);
  });

  it("measures a closure, not an account's age", () => {
    expect(isPastRetention(new Date("2016-10-31T12:00:00.000Z"), NOW)).toBe(true);
    expect(isPastRetention(new Date("2017-01-01T00:00:00.000Z"), NOW)).toBe(false);
    // An open account is never eligible, however old it is.
    expect(isPastRetention(null, NOW)).toBe(false);
    expect(isPastRetention(undefined, NOW)).toBe(false);
  });

  it("makes the due date and the cutoff the same instant", () => {
    const deletedAt = new Date("2020-05-05T00:00:00.000Z");
    expect(purgeDueAt(deletedAt).toISOString()).toBe("2030-05-05T00:00:00.000Z");
    expect(retentionCutoff(NOW).toISOString()).toBe("2016-10-31T12:00:00.000Z");
    // A closure exactly at the cutoff is due; one second later is not.
    expect(isPastRetention(retentionCutoff(NOW), NOW)).toBe(true);
    expect(isPastRetention(new Date(retentionCutoff(NOW).getTime() + 1), NOW)).toBe(false);
  });

  it("is disarmed unless the flag says otherwise, in so many words", () => {
    expect(purgeEnabled({})).toBe(false);
    expect(purgeEnabled({ RETENTION_PURGE_ENABLED: "" })).toBe(false);
    expect(purgeEnabled({ RETENTION_PURGE_ENABLED: "1" })).toBe(false);
    expect(purgeEnabled({ RETENTION_PURGE_ENABLED: "yes" })).toBe(false);
    expect(purgeEnabled({ RETENTION_PURGE_ENABLED: "false" })).toBe(false);
    expect(purgeEnabled({ RETENTION_PURGE_ENABLED: "true" })).toBe(true);
    expect(purgeEnabled({ RETENTION_PURGE_ENABLED: " TRUE " })).toBe(true);
  });
});

describe("the number stays on the server", () => {
  it("is not in the copy a customer reads", () => {
    const customerCopy = [
      "src/lib/account-deletion.ts",
      "src/app/dashboard/settings/DangerZone.tsx",
      "src/app/(site)/privacy/page.tsx",
    ];
    for (const file of customerCopy) {
      const source = read(file);
      expect(source, file).not.toMatch(/\b(10|ten)\s*years?\b/i);
      expect(source, file).not.toContain("RETENTION_YEARS");
      expect(source, file).not.toContain("retention.ts");
    }
  });

  it("is not shipped in a client bundle by accident", () => {
    // A `"use client"` module that imported the horizon would put the number in
    // the JavaScript every visitor downloads, which is disclosure whatever the UI
    // renders.
    const retention = read("src/lib/retention.ts");
    expect(retention).not.toContain('"use client"');
    expect(retention).toContain("export const RETENTION_YEARS = 10");
    expect(retention).toContain("purgeEnabled");

    const dangerZone = read("src/app/dashboard/settings/DangerZone.tsx");
    expect(dangerZone).toContain('"use client"');
    expect(dangerZone).not.toContain("@/lib/retention");
  });

  it("says in the docs that the horizon is a policy the owner set", () => {
    // The decision is dated so a future session knows it was chosen, not assumed.
    expect(read("STATUS.md")).toContain("ten years");
  });
});
