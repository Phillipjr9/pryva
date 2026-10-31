import { describe, expect, it } from "vitest";
import { securityRedirectTarget } from "@/lib/legacy-redirects";

describe("the old security route still lands on the right place", () => {
  it("goes to the security section of settings", () => {
    expect(securityRedirectTarget({})).toBe("/dashboard/settings#security");
  });

  it("carries the admin bounce with it", () => {
    expect(securityRedirectTarget({ require: "2fa", next: "/admin/withdrawals" })).toBe(
      "/dashboard/settings?require=2fa&next=%2Fadmin%2Fwithdrawals#security",
    );
  });

  it("keeps the first value of a repeated key, and skips blanks", () => {
    expect(securityRedirectTarget({ a: ["1", "2"] })).toBe("/dashboard/settings?a=1#security");
    expect(securityRedirectTarget({ require: "", next: undefined })).toBe(
      "/dashboard/settings#security",
    );
  });

  it("escapes what it has to", () => {
    expect(securityRedirectTarget({ next: "/dashboard?x=1&y=2" })).toBe(
      "/dashboard/settings?next=%2Fdashboard%3Fx%3D1%26y%3D2#security",
    );
  });
});
