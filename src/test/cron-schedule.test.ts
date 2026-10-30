import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the cron schedule rather than any runtime behaviour.
 *
 * Two failure modes here are invisible in every other test and in the build:
 * a schedule that Vercel's Hobby plan will not accept, and a path whose route
 * only exports POST -- Vercel Cron issues GET, so such a job is registered,
 * appears configured, and is answered with 405 forever. `scheduled-orders` is
 * exactly that route, which is why it is deliberately not listed.
 */

const root = process.cwd();

const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
  crons?: { path?: string; schedule?: string }[];
};

const crons = config.crons ?? [];

function routeSource(path: string): string {
  const relative = path.replace(/^\/+/, "").replace(/\/+$/, "");
  return readFileSync(join(root, "src", "app", relative, "route.ts"), "utf8");
}

describe("vercel.json cron schedule", () => {
  it("exists, because without it the cron endpoints are never called at all", () => {
    expect(crons.length).toBeGreaterThan(0);
  });

  it("stays within the Hobby plan limit of two jobs", () => {
    expect(crons.length).toBeLessThanOrEqual(2);
  });

  it("declares a path and a schedule for every job", () => {
    for (const cron of crons) {
      expect(typeof cron.path).toBe("string");
      expect(cron.path?.startsWith("/api/cron/")).toBe(true);
      expect(typeof cron.schedule).toBe("string");
    }
  });

  it("points only at routes that exist", () => {
    for (const cron of crons) {
      expect(() => routeSource(cron.path as string), `no route file for ${cron.path}`).not.toThrow();
    }
  });

  it("targets routes that answer GET, which is what Vercel Cron sends", () => {
    for (const cron of crons) {
      const source = routeSource(cron.path as string);
      expect(
        /export\s+(?:const|async\s+function)\s+GET\b/.test(source),
        `${cron.path} does not export GET, so the scheduled request would be rejected`,
      ).toBe(true);
    }
  });

  it("is never more frequent than daily, the Hobby plan minimum", () => {
    for (const cron of crons) {
      const fields = (cron.schedule as string).trim().split(/\s+/);
      expect(fields, `expected 5 cron fields in "${cron.schedule}"`).toHaveLength(5);
      const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
      // A fixed minute and hour with every wider field wildcarded is exactly one
      // run per day. Anything looser than daily is allowed but not expected here.
      expect(minute, `minute must be fixed in "${cron.schedule}"`).toMatch(/^\d+$/);
      expect(hour, `hour must be fixed in "${cron.schedule}"`).toMatch(/^\d+$/);
      expect(dayOfMonth).toBe("*");
      expect(month).toBe("*");
      expect(dayOfWeek).toBe("*");
    }
  });

  it("staggers jobs so they do not all fire in the same minute", () => {
    const slots = crons.map((cron) =>
      (cron.schedule as string).trim().split(/\s+/).slice(0, 2).join(":"),
    );
    expect(new Set(slots).size).toBe(slots.length);
  });
});
