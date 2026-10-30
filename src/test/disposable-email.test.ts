import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DISPOSABLE_EMAIL_DOMAINS,
  DISPOSABLE_EMAIL_ERROR,
  emailDomain,
  isDisposableEmailAddress,
} from "@/lib/disposable-domains";

const signup = readFileSync("src/app/api/auth/signup/route.ts", "utf8");

describe("disposable email addresses cannot create an account", () => {
  it("refuses the providers people actually reach for", () => {
    const blocked = [
      "someone@mailinator.com",
      "someone@guerrillamail.com",
      "someone@10minutemail.com",
      "someone@tempmail.com",
      "someone@temp-mail.org",
      "someone@yopmail.com",
      "someone@sharklasers.com",
      "someone@trashmail.com",
      "someone@maildrop.cc",
      "someone@getnada.com",
      "someone@discard.email",
      "someone@mailnesia.com",
      "someone@emailondeck.com",
      "someone@burnermail.io",
      "someone@mohmal.com",
    ];
    for (const email of blocked) {
      expect(isDisposableEmailAddress(email), email).toBe(true);
    }
  });

  it("catches a fresh subdomain and any casing or whitespace", () => {
    // A bare domain is not an address; the subdomain form is what providers hand out.
    expect(isDisposableEmailAddress("a1b2c3.mailinator.com")).toBe(false);
    expect(isDisposableEmailAddress("a1b2c3@mailinator.com")).toBe(true);
    expect(isDisposableEmailAddress("a1b2c3@anything.mailinator.com")).toBe(true);
    expect(isDisposableEmailAddress("Someone@YOPMail.com")).toBe(true);
    expect(isDisposableEmailAddress("  someone@tempmail.com  ")).toBe(true);
    expect(isDisposableEmailAddress("someone@mailinator.com.")).toBe(true);
  });

  it("never refuses an ordinary mailbox", () => {
    const allowed = [
      "someone@gmail.com",
      "someone@googlemail.com",
      "someone@outlook.com",
      "someone@hotmail.com",
      "someone@yahoo.com",
      "someone@icloud.com",
      "someone@proton.me",
      "someone@zoho.com",
      "someone@gmx.com",
      "someone@yandex.com",
      "someone@aol.com",
      "someone@pryva.ng",
      "someone@company.com.ng",
      "someone@lagosbusiness.example",
    ];
    for (const email of allowed) {
      expect(isDisposableEmailAddress(email), email).toBe(false);
    }
  });

  it("does not treat a lookalike domain as a provider", () => {
    // The check must not be a substring match: these are real domains a person
    // could own, and refusing them would be a bug a support ticket would find.
    // `notmailinator.com` is itself a Mailinator alias, so it is blocked; these
    // two merely contain the name.
    expect(isDisposableEmailAddress("someone@notmailinator.com")).toBe(true);
    expect(isDisposableEmailAddress("someone@xmailinator.com")).toBe(false);
    expect(isDisposableEmailAddress("someone@mailinator.com.evil.test")).toBe(false);
    expect(isDisposableEmailAddress("someone@tempmail.community")).toBe(false);
  });

  it("survives junk input without throwing", () => {
    for (const value of ["", "no-at-sign", "@", "a@", "@b.com", "a@@b.com"]) {
      expect(() => isDisposableEmailAddress(value)).not.toThrow();
    }
    expect(emailDomain("no-at-sign")).toBe("");
    expect(emailDomain("a@@b.com")).toBe("b.com");
  });

  it("is wired into signup before the row is created", () => {
    expect(signup).toContain("isDisposableEmailAddress(email)");
    expect(signup).toContain("DISPOSABLE_EMAIL_ERROR");
    // The refusal has to come before the insert, or the account exists anyway.
    const checkAt = signup.indexOf("isDisposableEmailAddress(email)");
    const insertAt = signup.indexOf("db.insert(users)");
    expect(checkAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(checkAt);
  });

  it("explains why, rather than saying 'invalid email'", () => {
    expect(DISPOSABLE_EMAIL_ERROR).toMatch(/temporary inboxes/i);
    expect(DISPOSABLE_EMAIL_ERROR).toMatch(/verification link|receipts|password reset/i);
  });

  it("keeps the list free of domains that serve real mailboxes", () => {
    const forbidden = [
      "gmail.com",
      "googlemail.com",
      "outlook.com",
      "hotmail.com",
      "yahoo.com",
      "icloud.com",
      "proton.me",
      "protonmail.com",
      "zoho.com",
      "yandex.com",
      "aol.com",
      "gmx.com",
      "mail.com",
      "pryva.ng",
    ];
    const list = new Set<string>(DISPOSABLE_EMAIL_DOMAINS as readonly string[]);
    for (const domain of forbidden) {
      expect(list.has(domain), `${domain} is a real provider`).toBe(false);
    }
  });

  it("has no duplicate entries", () => {
    const list = DISPOSABLE_EMAIL_DOMAINS as readonly string[];
    expect(new Set(list).size).toBe(list.length);
    for (const domain of list) {
      expect(domain).toBe(domain.toLowerCase());
      expect(domain).not.toContain("@");
    }
  });
});
