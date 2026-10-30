import { afterEach, describe, expect, it, vi } from "vitest";

import { resendConfigured } from "@/lib/resend-config";

describe("resendConfigured", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is false when neither variable is set", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("RESEND_FROM_EMAIL", "");
    expect(resendConfigured()).toBe(false);
  });

  it("is false when only the key is set", () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_secret");
    vi.stubEnv("RESEND_FROM_EMAIL", "");
    expect(resendConfigured()).toBe(false);
  });

  it("is false when only the sender address is set", () => {
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("RESEND_FROM_EMAIL", "Pryva <mail@pryva.test>");
    expect(resendConfigured()).toBe(false);
  });

  it("is true when both are set", () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_secret");
    vi.stubEnv("RESEND_FROM_EMAIL", "Pryva <mail@pryva.test>");
    expect(resendConfigured()).toBe(true);
  });

  it("treats whitespace-only values as unset", () => {
    vi.stubEnv("RESEND_API_KEY", "   ");
    vi.stubEnv("RESEND_FROM_EMAIL", "   ");
    expect(resendConfigured()).toBe(false);
  });

  it("rejects a sender address containing CR/LF", () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_secret");
    vi.stubEnv("RESEND_FROM_EMAIL", "Pryva <mail@pryva.test>\r\nBcc: attacker@evil.example");
    expect(resendConfigured()).toBe(false);
  });

  it("rejects an over-long sender address", () => {
    vi.stubEnv("RESEND_API_KEY", "re_test_secret");
    vi.stubEnv("RESEND_FROM_EMAIL", `${"a".repeat(256)}@pryva.test`);
    expect(resendConfigured()).toBe(false);
  });
});
