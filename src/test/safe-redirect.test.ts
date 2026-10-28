import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/safe-redirect";

describe("authentication redirect destinations", () => {
  it.each([
    undefined, null, "", "https://evil.example", "//evil.example", "///evil.example",
    "/\\evil.example", "/%5cevil.example", "/%2fevil.example", "/\nevil.example",
    "/dashboard%0d%0aLocation: https://evil.example",
  ])("rejects an unsafe destination %s", (value) => {
    expect(safeRedirectPath(value)).toBe("/dashboard");
  });

  it.each(["/dashboard", "/dashboard/orders?status=active", "/accounts#buy", "/"]) (
    "keeps the local path %s", (value) => expect(safeRedirectPath(value)).toBe(value),
  );
});
