import { afterEach, describe, expect, it, vi } from "vitest";
import { signState, stateAccepted, verifyState } from "@/lib/google-state";
import { GET as startGoogle } from "@/app/api/auth/google/route";

const SECRET = "GOCSPX-test-secret";
const T0 = 1_700_000_000_000;
afterEach(() => vi.unstubAllEnvs());

function withGoogle() {
  vi.stubEnv("GOOGLE_CLIENT_ID", "test-google-client");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", SECRET);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://pryvalogs.com");
}

function request(host: string, next = "/dashboard/orders") {
  return new Request(`https://${host}/api/auth/google?next=${encodeURIComponent(next)}`, {
    headers: { host, "x-forwarded-host": host, "x-forwarded-proto": "https" },
  });
}

describe("Google state binds the callback to the initiating browser", () => {
  it("rejects an authentic state in a different browser with no matching cookie", () => {
    withGoogle();
    const signed = signState("abc123", T0)!;
    expect(verifyState(signed, T0)).toBe(true);
    // A signed attacker-created state is valid, but not proof that this browser
    // initiated the login. Accepting it would allow Google login CSRF.
    expect(stateAccepted(signed, null, T0)).toBe(false);
    expect(stateAccepted(signed, undefined, T0)).toBe(false);
    expect(stateAccepted(signed, "different", T0)).toBe(false);
    expect(stateAccepted(signed, signed, T0)).toBe(true);
  });

  it("checks signature and expiry even when the cookie matches", () => {
    withGoogle();
    const signed = signState("abc123", T0)!;
    expect(stateAccepted(signed, signed, T0 + 9 * 60_000)).toBe(true);
    expect(stateAccepted(signed, signed, T0 + 11 * 60_000)).toBe(false);
    expect(stateAccepted(signed, signed, T0 - 1)).toBe(false);
    const tampered = signed.replace("abc123", "attacker");
    expect(stateAccepted(tampered, tampered, T0)).toBe(false);
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "changed-secret");
    expect(stateAccepted(signed, signed, T0)).toBe(false);
  });

  it("allows a matching legacy random nonce during rollout, never without its cookie", () => {
    const nonce = "a".repeat(40);
    expect(stateAccepted(nonce, nonce, T0)).toBe(true);
    expect(stateAccepted(nonce, null, T0)).toBe(false);
    expect(stateAccepted("valid", "valid", T0)).toBe(false);
  });

  it("rejects missing or malformed state", () => {
    withGoogle();
    expect(stateAccepted(null, null, T0)).toBe(false);
    expect(stateAccepted("", "", T0)).toBe(false);
    expect(verifyState("abc.x.y", T0)).toBe(false);
  });
});

describe("Google starts on the same canonical host that receives its callback", () => {
  it.each(["www.pryvalogs.com", "pryva-abc.vercel.app"])("redirects %s to the canonical start first", async (host) => {
    withGoogle();
    const response = await startGoogle(request(host));
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("https://pryvalogs.com");
    expect(location.pathname).toBe("/api/auth/google");
    expect(location.searchParams.get("next")).toBe("/dashboard/orders");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("sets a secure, host-only state cookie and uses the same canonical callback", async () => {
    withGoogle();
    const response = await startGoogle(request("pryvalogs.com"));
    const destination = new URL(response.headers.get("location")!);
    expect(destination.hostname).toBe("accounts.google.com");
    expect(destination.searchParams.get("redirect_uri")).toBe("https://pryvalogs.com/api/auth/google/callback");
    const cookie = response.headers.get("set-cookie")!;
    const state = destination.searchParams.get("state")!;
    expect(cookie).toContain(`pryva_google_state=${state}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(cookie).not.toContain("Domain=");
    expect(stateAccepted(state, state)).toBe(true);
  });

  it("does not preserve an external next URL through canonicalization", async () => {
    withGoogle();
    const response = await startGoogle(request("www.pryvalogs.com", "//evil.example/path"));
    expect(new URL(response.headers.get("location")!).searchParams.get("next")).toBe("/dashboard");
  });
});
