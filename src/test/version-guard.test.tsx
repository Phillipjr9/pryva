import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/version/route";
import { BUILD_GUARD_SCRIPT_ID, BUILD_ID, staleBuildScript } from "@/lib/build-id";

describe("build version endpoint", () => {
  it("reports the build this server is running", async () => {
    const response = GET();
    const body = (await response.json()) as { build?: string };

    expect(response.status).toBe(200);
    expect(body.build).toBeTruthy();
    expect(body.build).toBe(BUILD_ID);
  });

  it("is never cached, so an open tab can't be told it is up to date", () => {
    expect(GET().headers.get("cache-control")).toBe("no-store");
  });

  it("keeps one id per process instead of generating a new one per call", async () => {
    const first = ((await GET().json()) as { build: string }).build;
    const second = ((await GET().json()) as { build: string }).build;
    expect(first).toBe(second);
  });
});

describe("stale-build guard", () => {
  it("keeps one DOM id for the injected script", () => {
    expect(BUILD_GUARD_SCRIPT_ID).toBe("pryva-build-guard");
  });

  it("reloads at most twice, and never for a build it already tried", () => {
    const script = staleBuildScript("build-abc");

    expect(script).toContain("pryva:reloaded-for");
    expect(script).toContain("pryva:reloads");
    expect(script).toMatch(/n\s*>=\s*2/); // hard cap
    expect(script).toContain("location.reload()");
    expect(script).toContain('"build-abc"');
  });

  it("also checks when the tab is refocused, not only on load", () => {
    const script = staleBuildScript("build-abc");
    expect(script).toContain("visibilitychange");
    expect(script).toContain("pageshow");
  });
});
