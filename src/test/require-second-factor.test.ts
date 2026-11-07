import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  customerEnrolmentUrl,
  isSecondFactorExemptPath,
  secondFactorRequiredForAll,
  SECOND_FACTOR_REQUIRED_MESSAGE,
} from "@/lib/identity/require-second-factor";

/**
 * Requiring a second factor of *every* customer is a wall in front of the store,
 * not a control an operator opts into. These assertions describe the properties
 * that make the wall survivable rather than merely strict.
 */

const read = (path: string) => readFileSync(path, "utf8");
const auth = read("src/lib/identity/auth.ts");
const settingsPage = read("src/app/dashboard/settings/page.tsx");

describe("the switch is deliberate", () => {
  it("is off unless the operator says the literal word", () => {
    const original = process.env.REQUIRE_2FA_FOR_ALL;
    try {
      for (const value of [undefined, "", "0", "no", "TRUE", "1"]) {
        if (value === undefined) delete process.env.REQUIRE_2FA_FOR_ALL;
        else process.env.REQUIRE_2FA_FOR_ALL = value;
        expect(secondFactorRequiredForAll(), `value ${String(value)}`).toBe(false);
      }
      process.env.REQUIRE_2FA_FOR_ALL = "true";
      expect(secondFactorRequiredForAll()).toBe(true);
    } finally {
      if (original === undefined) delete process.env.REQUIRE_2FA_FOR_ALL;
      else process.env.REQUIRE_2FA_FOR_ALL = original;
    }
  });
});

describe("the rule cannot trap a customer who cannot satisfy it", () => {
  it("lets the settings page through, or the redirect would loop forever", () => {
    // `requireAuth` guards the settings page and also sends people *to* it.
    expect(isSecondFactorExemptPath("/dashboard/settings")).toBe(true);
  });

  it("lets the enrolment APIs through, or the rule refuses its own remedy", () => {
    for (const path of ["/api/security/2fa/start", "/api/security/2fa/confirm", "/api/security/2fa/disable"]) {
      expect(isSecondFactorExemptPath(path), path).toBe(true);
    }
  });

  it("lets a stuck customer sign out and ask who they are", () => {
    expect(isSecondFactorExemptPath("/api/auth/logout")).toBe(true);
    expect(isSecondFactorExemptPath("/api/auth/whoami")).toBe(true);
  });

  it("exempts nothing that can spend money or read an order", () => {
    const forbidden = [
      "/api/wallet/withdraw",
      "/api/orders/list",
      "/api/search",
      "/api/gift-cards/redeem",
      "/api/wallet/banks",
      "/dashboard/wallet",
    ];
    for (const path of forbidden) {
      expect(isSecondFactorExemptPath(path), path).toBe(false);
    }
  });
});

describe("both doors apply the rule", () => {
  it("guards pages with a redirect that says why and where to go", () => {
    expect(auth).toContain("secondFactorGateApplies(user.id)");
    expect(auth).toContain("customerEnrolmentUrl(destination)");
    expect(customerEnrolmentUrl("/dashboard/wallet")).toBe(
      "/dashboard/settings?require=2fa&next=%2Fdashboard%2Fwallet",
    );
    // The page the gate sends people to must understand the flag, or they land
    // on a settings page with no explanation.
    expect(settingsPage).toContain('params.require === "2fa"');
  });

  it("guards the API too, so the page rule is not theatre", () => {
    // A redirect in a route handler is HTML to a fetch caller; the API door
    // refuses instead of redirecting.
    expect(auth).toMatch(/requireAuthApi[\s\S]{0,2000}secondFactorGateApplies/);
  });

  it("never sends an operator into the storefront to arm the console", () => {
    // `requireAdmin` owns the operator path and uses /admin/account. Applying the
    // customer rule to an admin would bounce them into /dashboard/settings, which
    // is the confusion the two-surface split exists to prevent.
    expect(auth).toMatch(/!isAdminUser\(user\) && !isSecondFactorExemptPath/);
    expect(auth).toMatch(/!isAdminUser\(user\) && \(await secondFactorGateApplies/);
  });
});

describe("the enrolment routes survive the gate", () => {
  it("opts out explicitly rather than guessing the request path", () => {
    // There is no dependable way to read the pathname in a route handler, and a
    // gate that guessed would either refuse the remedy or wave through the rest.
    for (const path of [
      "src/app/api/security/2fa/start/route.ts",
      "src/app/api/security/2fa/confirm/route.ts",
      "src/app/api/security/2fa/disable/route.ts",
    ]) {
      expect(read(path), path).toContain("allowUnenrolled: true");
    }
  });
});

describe("the message explains the wall instead of just refusing", () => {
  it("says what to do next", () => {
    expect(SECOND_FACTOR_REQUIRED_MESSAGE).toMatch(/security settings/);
  });
});

describe("the operator enrolment page is reachable, which it was not", () => {
  const layout = read("src/app/admin/(console)/layout.tsx");
  const accountPage = read("src/app/admin/(console)/account/page.tsx");
  const proxy = read("src/proxy.ts");

  it("does not gate the page an unenrolled operator is sent to", () => {
    // requireAdmin redirects to /admin/account; the layout wraps /admin/account.
    // Gating it there sends the page to itself, forever.
    expect(layout).toContain("allowUnenrolled: true");
    expect(accountPage).toContain("allowUnenrolled: true");
  });

  it("takes the path from the proxy, not from the client", () => {
    // The exemption must key on what the edge resolved, never on a header a
    // caller supplied, or an unenrolled operator could exempt any page.
    expect(proxy).toContain("requestHeaders.set(\"x-pryva-pathname\", request.nextUrl.pathname)");
    expect(proxy).toContain("NextResponse.next({ request: { headers: requestHeaders } })");
    expect(layout).toContain('headers()).get("x-pryva-pathname")');
  });

  it("keeps the gate closed when the path is unknown", () => {
    // A null path must mean "not the enrolment screen". Any other reading opens
    // the console to every unenrolled operator whenever the header is missing.
    expect(layout).toMatch(/pathname !== null && \/\^\\\/admin\\\/account/);
  });

  it("still requires an administrator on that page", () => {
    expect(accountPage).toContain('requireAdmin("/admin/account", { allowUnenrolled: true })');
    expect(layout).toMatch(/requireAdmin\("\/admin", \{ allowUnenrolled: true \}\)/);
  });
});
