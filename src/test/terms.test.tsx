import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const terms = readFileSync("src/app/(site)/terms/page.tsx", "utf8");
const text = terms.replace(/\s+/g, " ");

/**
 * The terms are a promise made to customers, so the test checks that they still
 * describe the product that exists: every feature named in the clauses has to be
 * a feature the app actually has, and the limitations have to stay stated.
 */
describe("terms of service", () => {
  it("is dated, so a dispute can be settled against a known version", () => {
    expect(text).toContain('const LAST_UPDATED = "30 October 2026"');
    expect(text).toContain("Version in force from");
    expect(text).toContain("Earlier versions");
  });

  it("covers the features the product has added", () => {
    const required: Array<[string, RegExp]> = [
      ["gift cards", /gift cards? (are|is) not refundable/i],
      ["two-factor", /two-factor authentication/i],
      ["account lockout", /8 consecutive failures/i],
      ["verified reviews", /only be written by the account that bought the order/i],
      ["withdrawals", /withdrawn to a Nigerian bank account/i],
      ["temporary inbox refusal", /Temporary or disposable inboxes are refused/i],
      ["switched-off products", /cannot be ordered and cannot be charged/i],
      ["rate limits", /rate limited per connection/i],
      ["chargebacks", /chargeback/i],
    ];
    for (const [label, pattern] of required) {
      expect(pattern.test(text), label).toBe(true);
    }
  });

  it("points every cross-reference at a page that exists", () => {
    for (const href of [
      "/refund-policy",
      "/privacy",
      "/cookie-policy",
      "/contact",
      "/status",
      "/dashboard/settings#security",
      "/dashboard/settings",
    ]) {
      expect(text, href).toContain(`href="${href}"`);
    }
  });

  it("does not claim a guarantee it cannot keep", () => {
    // The product cannot promise a platform accepts a number or keeps an account.
    expect(text).toMatch(/do not promise uninterrupted service/i);
    expect(text).toMatch(/whether a particular platform accepts a number/i);
    expect(text).not.toMatch(/guaranteed delivery|100% success|always works/i);
  });

  it("names no supplier, and no registration number it cannot prove", () => {
    for (const word of ["supplier", "upstream", "reseller", "wholesale", "vendor"]) {
      expect(text.toLowerCase()).not.toContain(word);
    }
    expect(text).not.toMatch(/RC\s?\d{4,}/);
  });

  it("is styled by this build rather than by a typography plugin we do not load", () => {
    // `prose` classes came from @tailwindcss/typography, which is not installed,
    // so the old page rendered as unstyled body text.
    expect(terms).not.toMatch(/className="[^"]*\bprose\b/);
    expect(text).toContain("On this page");
    expect(text).toContain("In plain words");
  });

  it("is anchored, so a support reply can link to one clause", () => {
    const ids = [...terms.matchAll(/id: "([a-z-]+)",\s*\n\s*title:/g)].map((match) => match[1]);
    expect(ids.length).toBeGreaterThanOrEqual(15);
    expect(new Set(ids).size).toBe(ids.length);
    expect(terms).toContain("id={clause.id}");
    expect(terms).toContain("`#${clause.id}`");
  });
});
