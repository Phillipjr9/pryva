import { describe, expect, it } from "vitest";
import { BRAND_MARKS } from "@/lib/content/brand-marks";
import { MAIL_PROVIDER_MARKS, mailProviderBrand, mailProviderFaviconDomain } from "@/lib/services/numbers/mail-provider-marks";

/**
 * One listing, one logo.
 *
 * The bug this file pins: the temporary-inbox feed names a provider per listing,
 * but the catalogue recognised only six of them. GMX, iCloud, Yandex, Tuta,
 * mail.com, WEB.DE, QQ and Naver all fell through to the same envelope glyph, so
 * a grid of different products looked like one product repeated. Worse, that
 * glyph is the one the "Temporary inbox" card wears, so an unidentified provider
 * also read as the free tool.
 *
 * Three rules, each asserted separately so none can drift back:
 *
 *   1. Every provider in the table points at a REAL mark in `BRAND_MARKS`. A
 *      slug with no path data renders nothing at all, which is worse than a
 *      neutral tile, and the type of `brand` is `BrandSlug` so it fails to
 *      compile — this is the runtime half of that guard.
 *   2. Every mark is distinct. No two providers may share one logo, which is the
 *      owner's actual instruction.
 *   3. An unknown provider resolves to null and never to another provider's
 *      mark, so a named public site can use its own favicon instead.
 */
describe("mail provider marks", () => {
  it("resolves each provider the feed can name to its own real mark", () => {
    const expected: Array<[name: string, brand: string]> = [
      ["Gmail inbox", "gmail"],
      ["Google Mail (PVA)", "gmail"],
      ["Outlook inbox", "outlook"],
      ["Hotmail / Live inbox", "outlook"],
      ["Yahoo Mail inbox", "yahoo"],
      ["Proton Mail inbox", "protonmail"],
      ["Mail.ru inbox", "maildotru"],
      ["Zoho Mail inbox", "zoho"],
      ["GMX inbox", "gmx"],
      ["iCloud inbox", "icloud"],
      ["Yandex Mail inbox", "yandex"],
      ["Tuta inbox", "tuta"],
      ["Tutanota inbox", "tuta"],
      ["mail.com inbox", "maildotcom"],
      ["WEB.DE inbox", "webdotde"],
      ["QQ Mail inbox", "qq"],
      ["Naver Mail inbox", "naver"],
    ];

    for (const [name, brand] of expected) {
      expect(mailProviderBrand(name, null), `${name} should be ${brand}`).toBe(brand);
    }
  });

  it("reads the domain when the feed names a product only by its address", () => {
    // `FleexaEmailProduct` carries `name` and `domain` separately, and either can
    // be the only field with anything useful in it.
    expect(mailProviderBrand(null, "outlook.com")).toBe("outlook");
    expect(mailProviderBrand("Inbox", "web.de")).toBe("webdotde");
    expect(mailProviderBrand("Inbox", "mail.ru")).toBe("maildotru");
    expect(mailProviderBrand("Temporary inbox", "icloud.com")).toBe("icloud");
  });

  it("never gives two providers the same logo", () => {
    const brands = MAIL_PROVIDER_MARKS.map((provider) => provider.brand);
    expect(new Set(brands).size, "two providers share a brand mark").toBe(brands.length);

    const slugs = MAIL_PROVIDER_MARKS.map((provider) => provider.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("only points at marks that actually exist, so nothing renders blank", () => {
    for (const provider of MAIL_PROVIDER_MARKS) {
      const mark = BRAND_MARKS[provider.brand];
      expect(mark, `${provider.slug} points at "${provider.brand}", which has no mark`).toBeTruthy();
      expect(mark.body.length, `${provider.slug} has empty path data`).toBeGreaterThan(20);
      expect(mark.viewBox, `${provider.slug} has no viewBox`).toMatch(/^0 0 \d+ \d+$/);
    }
  });

  it("leaves a provider it does not know without another provider's logo", () => {
    for (const unknown of [
      "AOL inbox",
      "Fastmail inbox",
      "Seznam inbox",
      "Daum inbox",
      "163 inbox",
      "Mailinator inbox",
      "Temporary inbox",
      "",
      null,
    ]) {
      expect(mailProviderBrand(unknown, null), `${unknown} must not guess a brand`).toBeNull();
    }
  });

  it("does not match a short token inside another word", () => {
    // "qq" has to stand alone. A substring rule would fire on any name that
    // happened to contain those two letters, and hand it QQ's logo.
    expect(mailProviderBrand("Squqqle inbox", null)).toBeNull();
    // A site's name can contain the letters "mail.com" without being the
    // mail.com provider; the boundary keeps 10minutemail.com on its own favicon.
    expect(mailProviderBrand("10minutemail.com", null)).toBeNull();
    expect(mailProviderBrand("Tuta inbox", null)).toBe("tuta");
    // A dotted needle still matches as a substring, which is what picks up
    // addresses served from a provider subdomain.
    expect(mailProviderBrand("Inbox at mail.yandex.ru", null)).toBe("yandex");
  });

  it("never assigns a provider logo to an unrelated domain containing its name", () => {
    for (const domain of ["incogmail.com", "selfdestructingmail.com", "mymail-in.net", "mymailoasis.com", "proxymail.eu", "temporarymailaddress.com", "trash-mail.com", "trash-me.com", "temp-mail.ru", "fake-yahoo.com", "yahoo.com.evil.net"]) {
      expect(mailProviderBrand(domain, domain), domain).toBeNull();
      expect(mailProviderFaviconDomain(domain, domain), domain).toBe(domain);
    }
    expect(mailProviderBrand("Gmail inbox", "incogmail.com")).toBeNull();
    expect(mailProviderBrand("gmail.com", "gmail.com")).toBe("gmail");
    expect(mailProviderBrand("inbox.ru", "inbox.ru")).toBe("maildotru");
  });

  it("resolves a safe site domain for its own published favicon", () => {
    for (const domain of ["10minutemail.com", "126.com", "163.com", "adobe.com", "airbnb.com", "alibaba.com"]) {
      expect(mailProviderFaviconDomain(domain, null), `${domain} should have its own favicon`).toBe(domain);
    }
    expect(mailProviderFaviconDomain("Inbox", "https://airbnb.com/path")).toBe("airbnb.com");
  });

  it("rejects unsafe or non-public favicon hosts", () => {
    for (const [name, domain] of [
      ["mail.test", null],
      ["127.0.0.1", null],
      ["localhost", null],
      ["Inbox", "http://user:pass@example.com:8080/path"],
      ["Inbox", "example.internal"],
    ] as const) {
      expect(mailProviderFaviconDomain(name, domain)).toBeNull();
    }
  });

  it("keeps a more specific provider ahead of a broader one it contains", () => {
    // "Google Mail" contains "google", and "mail.ru" contains "mail"; the order
    // of the table is what stops either from resolving to the wrong brand.
    expect(mailProviderBrand("Google Mail inbox", null)).toBe("gmail");
    expect(mailProviderBrand("Mail.ru inbox", null)).toBe("maildotru");
    expect(mailProviderBrand("mail.com inbox", null)).toBe("maildotcom");
  });
});
