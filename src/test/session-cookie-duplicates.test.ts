import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE,
  SESSION_COOKIE_EMBEDDED,
  SESSION_TOKENS_HEADER,
  cookieHeaderWithout,
  copiesToClear,
  expirySetCookies,
  sessionCookieCopies,
  sessionTokensForHeader,
} from "@/lib/platform/session-cookies";

/**
 * A browser can hold two cookies called `pryva_session`.
 *
 * One is host-only, written before the site moved to its own domain; the other
 * carries `Domain=pryvalogs.com`, written afterwards. They are different cookies
 * to the browser, so signing in adds one instead of replacing the other. Every
 * request then carries both, and Next keeps only one of them — and RFC 6265 says
 * a server may not rely on the order they arrive in.
 *
 * When the dead copy is the one kept, the symptom is a visitor who signs in
 * successfully, receives a valid cookie, and is treated as signed out on every
 * page. These tests cover the raw-header handling that makes both copies usable
 * and lets the dead one be removed.
 */

const root = join(process.cwd(), "src");
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("reading every copy", () => {
  it("finds both copies of the same name, in the order sent", () => {
    const copies = sessionCookieCopies("pryva_session=stale; other=1; pryva_session=live");
    expect(copies).toEqual([
      { name: SESSION_COOKIE, value: "stale" },
      { name: SESSION_COOKIE, value: "live" },
    ]);
  });

  it("includes the embedded fallback and ignores everything else", () => {
    const copies = sessionCookieCopies(
      `theme=dark; ${SESSION_COOKIE_EMBEDDED}=abc; ${SESSION_COOKIE}=xyz; ref=promo`,
    );
    expect(copies.map((copy) => copy.name)).toEqual([SESSION_COOKIE_EMBEDDED, SESSION_COOKIE]);
  });

  it("handles a missing header and malformed parts without throwing", () => {
    expect(sessionCookieCopies(null)).toEqual([]);
    expect(sessionCookieCopies(undefined)).toEqual([]);
    expect(sessionCookieCopies("garbage; =novalue; ok=1")).toEqual([]);
    // An empty value is not a session.
    expect(sessionCookieCopies("pryva_session=")).toEqual([]);
  });

  it("keeps a value that itself contains an equals sign", () => {
    // Base64-ish tokens legitimately end in `=`; splitting on every `=` truncates
    // the token and turns a valid session into a permanent miss.
    const copies = sessionCookieCopies("pryva_session=abc123==");
    expect(copies[0]?.value).toBe("abc123==");
  });
});

describe("the token list handed to the app", () => {
  it("puts the first-party name before the embedded fallback", () => {
    const header = sessionTokensForHeader([
      { name: SESSION_COOKIE_EMBEDDED, value: "fallback" },
      { name: SESSION_COOKIE, value: "primary" },
    ]);
    expect(header).toBe("primary,fallback");
  });

  it("de-duplicates, because the same token can arrive under both names", () => {
    const header = sessionTokensForHeader([
      { name: SESSION_COOKIE, value: "same" },
      { name: SESSION_COOKIE_EMBEDDED, value: "same" },
    ]);
    expect(header).toBe("same");
  });

  it("is bounded, so a hostile header cannot inflate the lookup loop", () => {
    const copies = Array.from({ length: 50 }, (_, index) => ({
      name: SESSION_COOKIE,
      value: `token-${index}`,
    }));
    expect(sessionTokensForHeader(copies).split(",").length).toBeLessThanOrEqual(6);
  });

  it("is empty when there is nothing to try", () => {
    expect(sessionTokensForHeader([])).toBe("");
  });
});

describe("removing only the copies that are going", () => {
  it("keeps every other cookie byte-for-byte", () => {
    const header = "theme=dark; pryva_session=dead; ref=promo; other=a=b";
    expect(cookieHeaderWithout(header, [{ name: SESSION_COOKIE, value: "dead" }])).toBe(
      "theme=dark; ref=promo; other=a=b",
    );
  });

  it("removes the named copy and leaves a live one of the same name alone", () => {
    const header = "pryva_session=dead; pryva_session=live";
    expect(cookieHeaderWithout(header, [{ name: SESSION_COOKIE, value: "dead" }])).toBe(
      "pryva_session=live",
    );
  });

  it("clears at most two per response", () => {
    const dead = Array.from({ length: 5 }, (_, index) => ({
      name: SESSION_COOKIE,
      value: `dead-${index}`,
    }));
    expect(copiesToClear(dead)).toHaveLength(2);
  });
});

describe("the expiry headers", () => {
  it("can express both the host-only and the domain form", () => {
    // The browser removes exactly the cookie whose name, path and domain match,
    // and a host-only cookie has no Domain attribute at all.
    const [hostOnly, withDomain] = expirySetCookies(
      { name: SESSION_COOKIE, value: "dead" },
      [undefined, "pryvalogs.com"],
    );
    expect(hostOnly).not.toContain("Domain=");
    expect(withDomain).toContain("Domain=pryvalogs.com");
    for (const header of [hostOnly, withDomain]) {
      expect(header).toContain("Max-Age=0");
      expect(header).toContain("Path=/");
      expect(header).toContain("HttpOnly");
      expect(header).toContain("Secure");
    }
  });
});

describe("the wiring that makes it reachable", () => {
  it("the proxy hands over every copy, and never trusts an inbound header", () => {
    const proxy = read("proxy.ts");
    // The synthetic header must be written from the parsed Cookie header...
    expect(proxy).toContain("sessionCookieCopies(request.headers.get(\"cookie\"))");
    expect(proxy).toContain("requestHeaders.set(SESSION_TOKENS_HEADER");
    // ...and removed when there is nothing to put in it, so a caller cannot
    // smuggle candidates in on its own request.
    expect(proxy).toContain("requestHeaders.delete(SESSION_TOKENS_HEADER)");
  });

  it("auth reads the forwarded tokens before falling back to the jar", () => {
    const auth = read("lib/identity/auth.ts");
    // Search inside the reader itself: the first mention of the header in the
    // file is the import, which would make a naive index comparison meaningless.
    const start = auth.indexOf("async function requestSessionTokens");
    expect(start).toBeGreaterThan(-1);
    const body = auth.slice(start, auth.indexOf("export async function getCurrentUser"));
    const forwarded = body.indexOf("headerList.get(SESSION_TOKENS_HEADER)");
    const jarRead = body.indexOf("jar.get(cookie)");
    expect(forwarded).toBeGreaterThan(-1);
    expect(jarRead).toBeGreaterThan(-1);
    // The proxy's list is the primary source; the jar only fills in when the
    // proxy did not run for this request.
    expect(forwarded).toBeLessThan(jarRead);
  });

  it("never expires a cookie it has not checked, and never on a store failure", () => {
    const auth = read("lib/identity/auth.ts");
    // Dead tokens come only from a lookup that ran and matched no session.
    expect(auth).toContain("dead.push(token)");
    // A store error reports nothing dead, so an outage cannot sign everyone out.
    expect(auth).toContain("return { user: null, deadTokens: [], tokens: [...tokens], resolved: false }");
    expect(auth).toContain("if (!resolved || !deadTokens.length) return");
  });

  it("does not expire a cookie that authenticated the request", () => {
    const auth = read("lib/identity/auth.ts");
    // The live token is returned immediately with only the tokens checked before
    // it reported dead — everything after it is never even examined.
    expect(auth).toContain("if (user) return { user: toPublicUser(user), deadTokens: dead");
  });
});
