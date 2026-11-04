import { afterEach, describe, expect, it, vi } from "vitest";

import { signState, stateAccepted, verifyState } from "@/lib/google-state";

/**
 * The Google callback used to require a `SameSite=Lax` cookie to survive a
 * cross-site redirect, which it is not guaranteed to do. Chrome's `Lax+POST`
 * exemption covers a top-level POST; Google returns with a redirect GET. A
 * withheld cookie therefore failed the state check and sent the user to
 * `/login?error=google-state`, indistinguishable from a bad redirect-URI
 * configuration.
 *
 * The state now carries its own signature so it can be authenticated without the
 * cookie. That is a real widening of what the callback accepts, so these pin both
 * halves: the cookie-free return works, and everything an attacker could mint
 * without the secret does not.
 */
const SECRET = "GOCSPX-test-secret";
const T0 = 1_700_000_000_000;

afterEach(() => vi.unstubAllEnvs());

function withSecret() {
  vi.stubEnv("GOOGLE_CLIENT_SECRET", SECRET);
}

describe("a signed state authenticates without the cookie", () => {
  it("round-trips when the browser withholds the cookie", () => {
    withSecret();
    const signed = signState("abc123", T0)!;
    expect(signed).toBeTruthy();
    // No cookie at all: the case that used to fail.
    expect(stateAccepted(signed, null, T0)).toBe(true);
    expect(stateAccepted(signed, undefined, T0)).toBe(true);
  });

  it("still requires the cookie to match when one is sent", () => {
    withSecret();
    const signed = signState("abc123", T0)!;
    // A present cookie is stronger evidence, and disagreement is a real fault.
    expect(stateAccepted(signed, signed, T0)).toBe(true);
    expect(stateAccepted(signed, "different-state", T0)).toBe(false);
  });

  it("rejects a bare nonce, which is what the flow used to send", () => {
    withSecret();
    expect(stateAccepted("deadbeef", null, T0)).toBe(false);
    expect(verifyState("deadbeef", T0)).toBe(false);
  });
});

describe("nothing forgeable is accepted", () => {
  it("rejects a state signed with a different secret", () => {
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "some-other-secret");
    const forged = signState("abc123", T0)!;
    vi.stubEnv("GOOGLE_CLIENT_SECRET", SECRET);
    expect(stateAccepted(forged, null, T0)).toBe(false);
  });

  it("rejects a tampered nonce", () => {
    withSecret();
    const signed = signState("abc123", T0)!;
    const parts = signed.split(".");
    const tampered = ["attacker", parts[1], parts[2]].join(".");
    expect(stateAccepted(tampered, null, T0)).toBe(false);
  });

  it("rejects a tampered issue time, which would otherwise extend the window", () => {
    withSecret();
    const signed = signState("abc123", T0)!;
    const parts = signed.split(".");
    const tampered = [parts[0], String(T0 + 60_000), parts[2]].join(".");
    expect(stateAccepted(tampered, null, T0)).toBe(false);
  });

  it("rejects a replayed state once its window has passed", () => {
    withSecret();
    const signed = signState("abc123", T0)!;
    expect(stateAccepted(signed, null, T0 + 9 * 60_000)).toBe(true);
    expect(stateAccepted(signed, null, T0 + 11 * 60_000)).toBe(false);
  });

  it("rejects a future timestamp rather than accepting an unbounded window", () => {
    withSecret();
    const signed = signState("abc123", T0 + 60_000)!;
    expect(stateAccepted(signed, null, T0)).toBe(false);
  });

  it("rejects everything when no secret is configured", () => {
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    expect(signState("abc123", T0)).toBeNull();
    expect(stateAccepted("abc123", null, T0)).toBe(false);
    expect(verifyState("abc123.x.y", T0)).toBe(false);
  });

  it("rejects a missing state outright", () => {
    withSecret();
    expect(stateAccepted(null, null, T0)).toBe(false);
    expect(stateAccepted("", "", T0)).toBe(false);
  });
});

describe("the callback consults it", () => {
  it("no longer requires the cookie to be present", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(
      new URL("../app/api/auth/google/callback/route.ts", import.meta.url),
      "utf8",
    );
    // The old check, which this change exists to replace.
    expect(source).not.toContain("!expectedState || state !== expectedState");
    expect(source).toContain("stateAccepted(state, expectedState)");
  });
});
