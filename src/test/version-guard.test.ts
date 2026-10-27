import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/version/route";
import { BUILD_ID } from "@/lib/build-id";

describe("build version endpoint", () => {
  it("reports the build this server is running", async () => {
    const response = GET();
    const body = (await response.json()) as { build?: string };

    expect(response.status).toBe(200);
    expect(body.build).toBeTruthy();
    expect(body.build).toBe(BUILD_ID);
  });

  it("is never cached, so an open tab can't be told it is up to date", () => {
    const response = GET();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps one id per process instead of generating a new one per call", async () => {
    const first = ((await GET().json()) as { build: string }).build;
    const second = ((await GET().json()) as { build: string }).build;
    expect(first).toBe(second);
  });
});
