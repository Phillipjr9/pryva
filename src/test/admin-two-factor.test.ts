import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  twoFactorAvailable: vi.fn(),
  getEnrolment: vi.fn(),
}));

vi.mock("@/lib/two-factor", () => ({
  twoFactorAvailable: mocks.twoFactorAvailable,
  getEnrolment: mocks.getEnrolment,
}));

const { ADMIN_2FA_MESSAGE, adminBlockedForMissingSecondFactor, adminTwoFactorRequired } =
  await import("@/lib/admin-two-factor");

const ADMIN_ID = "8d1f4e3a-2b6c-4d5e-9f01-2a3b4c5d6e7f";

beforeEach(() => {
  vi.unstubAllEnvs();
  mocks.twoFactorAvailable.mockReturnValue(true);
  mocks.getEnrolment.mockResolvedValue({ enabledAt: null, secret: "" });
});

describe("administrator second factor", () => {
  it("is required by default", () => {
    expect(adminTwoFactorRequired()).toBe(true);
  });

  it("can be turned off explicitly, and only by the exact value", () => {
    vi.stubEnv("ADMIN_2FA_REQUIRED", "false");
    expect(adminTwoFactorRequired()).toBe(false);
    vi.stubEnv("ADMIN_2FA_REQUIRED", "0");
    expect(adminTwoFactorRequired()).toBe(true);
    vi.stubEnv("ADMIN_2FA_REQUIRED", "no");
    expect(adminTwoFactorRequired()).toBe(true);
  });

  it("blocks an administrator who has not enrolled", async () => {
    expect(await adminBlockedForMissingSecondFactor(ADMIN_ID)).toBe(true);
  });

  it("lets an enrolled administrator through", async () => {
    mocks.getEnrolment.mockResolvedValue({ enabledAt: new Date("2026-10-01T00:00:00Z"), secret: "s" });
    expect(await adminBlockedForMissingSecondFactor(ADMIN_ID)).toBe(false);
  });

  it("does not lock everyone out of a deployment that cannot enrol anyone", async () => {
    // Without TWO_FACTOR_KEY nobody can enrol, so enforcing would close the admin
    // area permanently. The runbook treats that configuration as a defect.
    mocks.twoFactorAvailable.mockReturnValue(false);
    expect(await adminBlockedForMissingSecondFactor(ADMIN_ID)).toBe(false);
    expect(mocks.getEnrolment).not.toHaveBeenCalled();
  });

  it("honours the override even for an administrator with no factor", async () => {
    vi.stubEnv("ADMIN_2FA_REQUIRED", "false");
    expect(await adminBlockedForMissingSecondFactor(ADMIN_ID)).toBe(false);
  });

  it("explains itself, because a bare 403 sends people to support", () => {
    expect(ADMIN_2FA_MESSAGE).toMatch(/two-factor authentication/i);
    expect(ADMIN_2FA_MESSAGE).toMatch(/security/i);
  });
});

describe("the rule is wired into both doors", () => {
  const auth = readFileSync("src/lib/auth.ts", "utf8");
  const adminApi = readFileSync("src/lib/admin-auth.ts", "utf8");
  const settingsPage = readFileSync("src/app/dashboard/settings/page.tsx", "utf8");
  const securitySection = readFileSync("src/app/dashboard/settings/SecuritySection.tsx", "utf8");

  it("guards the admin pages, and sends the operator to the page that fixes it", () => {
    expect(auth).toContain("adminBlockedForMissingSecondFactor(user.id)");
    // Security is a section of Settings, so the bounce carries the anchor as
    // well as the explanation.
    expect(auth).toContain("/dashboard/settings?require=2fa");
    expect(auth).toContain("#security");
  });

  it("guards the admin API too, so the page rule is not theatre", () => {
    expect(adminApi).toContain("adminBlockedForMissingSecondFactor(user.id)");
    expect(adminApi).toContain("ADMIN_2FA_MESSAGE");
  });

  it("says why the tools are closed instead of failing silently", () => {
    expect(settingsPage).toContain('params.require === "2fa"');
    expect(settingsPage).toContain("locked until two-factor is on");
    // And the section the bounce points at renders the thing that fixes it.
    expect(securitySection).toContain('id="security"');
    expect(securitySection).toContain("TwoFactorCard");
  });
});
