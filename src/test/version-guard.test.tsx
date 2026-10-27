import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GET } from "@/app/api/version/route";
import { BUILD_ID, staleBuildScript } from "@/lib/build-id";
import RootLayout from "@/app/layout";

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
  it("ships as inline HTML script, not a component that a stale tab lacks", () => {
    // The whole point: a tab one build behind still has the *old* React bundle,
    // so the check must arrive with the server-rendered HTML.
    const html = renderToStaticMarkup(
      <RootLayout>
        <p>page</p>
      </RootLayout>,
    );

    expect(html).toContain('data-pryva-build="');
    expect(html).toContain(BUILD_ID);
    expect(html).toContain('fetch("/api/version"');
  });

  it("reloads at most twice, and never for a build it already tried", () => {
    const script = staleBuildScript("build-abc");

    expect(script).toContain("pryva:reloaded-for");
    expect(script).toContain("pryva:version-reloads");
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
