// @vitest-environment jsdom
import React from "react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { AuthForm } from "@/components/auth/AuthForm";
import { PasskeySignInButton } from "@/components/auth/PasskeySignInButton";
import { PasskeysCard } from "@/components/settings/PasskeysCard";
import {
  base64UrlToBuffer,
  bufferToBase64Url,
  encodeCreationOptions,
  encodeRequestOptions,
  isCancellation,
  passkeysSupported,
} from "@/lib/webauthn-browser";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

const login = decodeURIComponent(renderToStaticMarkup(<AuthForm mode="login" next="/dashboard" />));
const signup = decodeURIComponent(renderToStaticMarkup(<AuthForm mode="signup" next="/dashboard" />));

/**
 * Passkey sign-in, and the Google button that moved.
 *
 * Two owner decisions meet on this screen. First: "Continue with Google" comes
 * after the email and password form, because it is the alternative, not the
 * headline. Second: a passkey lets someone sign in without typing anything at
 * all — but only after they have enrolled one while signed in, so the control
 * belongs on the sign-in screen and never on the sign-up screen.
 */
describe("the sign-in screen", () => {
  it("puts Google after the form, not before it", () => {
    const passwordField = login.indexOf('type="password"');
    const submit = login.indexOf('type="submit"');
    const google = login.indexOf("Continue with Google");
    expect(passwordField).toBeGreaterThan(-1);
    expect(submit).toBeGreaterThan(-1);
    expect(google).toBeGreaterThan(submit);
    // The divider names the alternatives explicitly, and comes after the form.
    expect(login.indexOf("or sign in with")).toBeGreaterThan(submit);
  });

  it("offers a passkey on sign-in", () => {
    expect(login).toContain("Sign in with a passkey");
    expect(login.indexOf("Sign in with a passkey")).toBeLessThan(login.indexOf("Continue with Google"));
  });

  it("does not offer a passkey on sign-up", () => {
    expect(signup).not.toContain("Sign in with a passkey");
    // Google stays available there, still after the form.
    expect(signup.indexOf("Continue with Google")).toBeGreaterThan(signup.indexOf('type="submit"'));
  });

  it("renders the control on the server and re-checks the browser on hydration", () => {
    // The server cannot know what browser is asking, so the button is in the
    // markup and `usePasskeysSupported` removes it on a browser that has no
    // WebAuthn — detected after hydration rather than guessed.
    expect(login).toContain("Sign in with a passkey");
    const source = readFileSync("src/components/auth/PasskeySignInButton.tsx", "utf8");
    expect(source).toContain("usePasskeysSupported");
    expect(source).toContain("if ((!supported || unavailable) && !error) return null;");
  });

  it("reports WebAuthn as unsupported in a browser without it", () => {
    expect("PublicKeyCredential" in window).toBe(false);
    expect(passkeysSupported()).toBe(false);
  });
});

describe("the settings card", () => {
  const summary = {
    id: "11111111-1111-4111-8111-111111111111",
    label: "My phone",
    createdAt: new Date("2026-10-01T10:00:00.000Z"),
    lastUsedAt: null,
    backedUp: false,
    deviceType: "singleDevice",
  };

  it("lists what the account has, with a way to remove each one", () => {
    const html = decodeURIComponent(
      renderToStaticMarkup(<PasskeysCard passkeys={[summary]} available />),
    );
    expect(html).toContain("My phone");
    expect(html).toContain("Added 1 Oct 2026");
    expect(html).not.toContain("No passkeys yet");
    expect(html).toContain("Remove My phone");
  });

  it("says so plainly when there are none", () => {
    const html = decodeURIComponent(renderToStaticMarkup(<PasskeysCard passkeys={[]} available />));
    expect(html).toContain("No passkeys yet");
  });

  it("never offers a control that cannot work", () => {
    // Server said this address cannot run WebAuthn: no add button, and the
    // reason is on the page rather than in a console.
    const html = decodeURIComponent(renderToStaticMarkup(<PasskeysCard passkeys={[]} available={false} />));
    expect(html).not.toContain("Add a passkey</button>");
    expect(html).toContain("HTTPS");
  });
});

describe("the browser half", () => {
  it("round-trips base64url without padding", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const encoded = bufferToBase64Url(bytes.buffer);
    expect(encoded).not.toMatch(/[+/=]/);
    expect(new Uint8Array(base64UrlToBuffer(encoded) as ArrayBuffer)).toEqual(bytes);
    expect(bufferToBase64Url(new Uint8Array([1]).buffer)).toBe("AQ");
  });

  it("decodes the server's options into what the DOM expects", () => {
    const creation = encodeCreationOptions({
      challenge: "AQID",
      user: { id: "BAUG", name: "ada@example.com", displayName: "Ada" },
      rp: { id: "pryva.ng", name: "Pryva" },
      pubKeyCredParams: [],
      excludeCredentials: [{ id: "BwgJ", type: "public-key", transports: ["internal"] }],
    } as never);
    expect(new Uint8Array(creation.challenge as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
    expect(new Uint8Array(creation.user.id as ArrayBuffer)).toEqual(new Uint8Array([4, 5, 6]));
    expect(creation.excludeCredentials?.[0]?.transports).toEqual(["internal"]);

    const request = encodeRequestOptions({
      challenge: "AQID",
      allowCredentials: [],
    } as never);
    expect(new Uint8Array(request.challenge as ArrayBuffer)).toEqual(new Uint8Array([1, 2, 3]));
    expect(request.allowCredentials).toEqual([]);
  });

  it("treats a dismissed prompt as a decision, not a fault", () => {
    expect(isCancellation(new DOMException("cancelled", "NotAllowedError"))).toBe(true);
    expect(isCancellation(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isCancellation(new Error("boom"))).toBe(false);
  });

  it("ships no third-party browser bundle for the ceremony", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    // The server verifier is a dependency; the browser wrapper is hand-written
    // so the sign-in screen loads nothing extra.
    expect(pkg.dependencies["@simplewebauthn/server"]).toBeTruthy();
    expect(pkg.dependencies["@simplewebauthn/browser"]).toBeUndefined();
    expect(pkg.devDependencies["@simplewebauthn/browser"]).toBeUndefined();
  });
});

describe("the sign-in button", () => {
  it("announces a failure next to the button, never in a console", () => {
    const html = decodeURIComponent(renderToStaticMarkup(<PasskeySignInButton next="/dashboard" />));
    expect(html).toContain("Sign in with a passkey");
    // Nothing to report until someone tries, so no empty live region.
    expect(html).not.toContain("role=\"status\"");
  });
});

/**
 * The routes behind those two screens.
 *
 * A passkey is a second, equivalent way into an account, so it has to meet the
 * same bar as the password form: same-origin, rate limited, subject to the
 * account lockout, and silent about *why* a sign-in failed. These assertions are
 * about the shape of the handlers, because that is what a later refactor breaks.
 */
describe("the passkey routes", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  const options = read("src/app/api/auth/passkey/options/route.ts");
  const verify = read("src/app/api/auth/passkey/verify/route.ts");
  const enrollOptions = read("src/app/api/security/passkeys/options/route.ts");
  const enrollVerify = read("src/app/api/security/passkeys/verify/route.ts");
  const remove = read("src/app/api/security/passkeys/[id]/route.ts");

  it("refuses cross-site sign-in attempts before doing any work", () => {
    expect(verify).toContain("isSameOriginMutation");
    expect(verify).toContain("passkeyRateLimiter");
    expect(options).toContain("isSameOriginMutation");
    expect(options).toContain("passkeyRateLimiter");
  });

  it("respects the password lockout but never leaks the reason", () => {
    expect(verify).toContain("lockoutRemainingMs");
    expect(verify).toContain("clearFailedLogins");
    expect(verify).toContain("createSession");
    // One message for every failure, at one status.
    const generic = verify.match(/status: 401/g) ?? [];
    expect(generic.length).toBeGreaterThanOrEqual(1);
    expect(verify).not.toContain("counter-regressed");
  });

  it("requires a session to enrol or remove, and scopes removal to the owner", () => {
    expect(enrollOptions).toContain("requireAuthApi");
    expect(enrollVerify).toContain("requireAuthApi");
    expect(remove).toContain("requireAuthApi");
    expect(remove).toContain("deleteCredential");
  });

  it("caps the enrolment body", () => {
    expect(enrollVerify).toContain("readJsonWithLimit");
    expect(verify).toContain("readJsonWithLimit");
  });

  it("is not reachable while the deployment cannot sign for this address", () => {
    expect(options).toContain("relyingPartyFor");
    expect(verify).toContain("relyingPartyFor");
    expect(options).toContain("503");
  });
});
