import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { diagnosticsAuthorized, diagnosticsDenial, diagnosticsDenialContext } from "@/lib/admin/diagnostics-auth";

/**
 * The diagnostics gate.
 *
 * Every read-only report shares this check, so its behaviour is the difference
 * between "a report nobody can read" and "a report anybody can read". Two things
 * are load-bearing and easy to lose in a refactor: an unset or blank secret can
 * never match, and the header is compared whole, so a bearer carrying stray
 * whitespace is refused rather than trimmed into a match.
 *
 * The refusal reason is not returned to the caller — the response is a bare 401
 * — but it is what makes the server log actionable. A production-only,
 * `sensitive` variable cannot be read back and does not exist in a preview
 * deployment, so "which of the three things went wrong" is otherwise unknowable.
 */

const env = { ...process.env };

function request(authorization?: string) {
  const headers = new Headers();
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new NextRequest(new URL("https://pryva.test/api/diagnostics/stock"), { headers });
}

beforeEach(() => {
  delete process.env.DIAGNOSTICS_SECRET;
  delete process.env.CRON_SECRET;
});

afterEach(() => {
  process.env = { ...env };
});

describe("diagnosticsDenial", () => {
  it("names a missing header", () => {
    process.env.DIAGNOSTICS_SECRET = "read-only-secret";
    expect(diagnosticsDenial(request())).toBe("missing-header");
    expect(diagnosticsAuthorized(request())).toBe(false);
  });

  it("names an environment with no secret configured", () => {
    expect(diagnosticsDenial(request("Bearer anything"))).toBe("no-secret-configured");
  });

  it("treats a blank secret as unconfigured, so it can never match", () => {
    process.env.DIAGNOSTICS_SECRET = "   ";
    process.env.CRON_SECRET = "";
    expect(diagnosticsDenial(request("Bearer "))).toBe("no-secret-configured");
  });

  it("names a presented secret that does not match", () => {
    process.env.DIAGNOSTICS_SECRET = "read-only-secret";
    expect(diagnosticsDenial(request("Bearer wrong-secret"))).toBe("secret-mismatch");
  });

  it("accepts the configured secret exactly", () => {
    process.env.DIAGNOSTICS_SECRET = "read-only-secret";
    expect(diagnosticsDenial(request("Bearer read-only-secret"))).toBeNull();
    expect(diagnosticsAuthorized(request("Bearer read-only-secret"))).toBe(true);
  });

  it("trims the configured secret, and repairs nothing the header does not", () => {
    process.env.DIAGNOSTICS_SECRET = "  read-only-secret\n";
    expect(diagnosticsDenial(request("Bearer read-only-secret"))).toBeNull();
    // Surrounding whitespace never reaches this function: Headers strips it per
    // the fetch spec, so a secret stored with a trailing newline in the Vercel
    // dashboard still matches. Whitespace *inside* the header is not repaired.
    expect(diagnosticsDenial(request("Bearer read-only-secret "))).toBeNull();
    expect(diagnosticsDenial(request("Bearer  read-only-secret"))).toBe("secret-mismatch");
    expect(diagnosticsDenial(request("bearer read-only-secret"))).toBe("secret-mismatch");
  });

  it("still accepts CRON_SECRET for deployments without the newer variable", () => {
    process.env.CRON_SECRET = "cron-secret";
    expect(diagnosticsDenial(request("Bearer cron-secret"))).toBeNull();
  });

  it("reports the configuration without leaking either secret", () => {
    process.env.DIAGNOSTICS_SECRET = "read-only-secret";
    const context = diagnosticsDenialContext(request("Bearer wrong-secret"));
    expect(context).toEqual({
      reason: "secret-mismatch",
      presentsBearer: true,
      hasDiagnosticsSecret: true,
      hasCronSecret: false,
    });
    expect(JSON.stringify(context)).not.toContain("read-only-secret");
  });
});
