import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AccountProvenancePage from "@/app/(site)/account-provenance/page";
import AccountsPage from "@/app/(site)/accounts/page";
import sitemap from "@/app/sitemap";

describe("public account provenance policy", () => {
  it("applies the published requirements to the entire live account catalogue", () => {
    const html = renderToStaticMarkup(<AccountProvenancePage />);
    expect(html).toContain("Account Provenance &amp; Transfer Policy");
    expect(html).toContain("every digital account currently offered");
    expect(html).toContain("not only to accounts added after its publication date");
    expect(html).toContain("original account holder or has documented authorization");
    expect(html).toContain("explicit permission for the account to be transferred or resold");
    expect(html).toContain("permitted by the applicable platform");
    expect(html).toContain("rejected or suspended");
    expect(html).toContain("A supplier declaration is not independent proof of consent");
    expect(html).toContain("Do not send passwords, active credentials");
    expect(html).toContain('href="/contact"');
  });

  it("aligns the marketplace notice and removes the conflicting unscreened-account disclaimer", () => {
    const html = renderToStaticMarkup(<AccountsPage />);
    expect(html).toContain('href="/account-provenance"');
    expect(html).toContain("Every account currently offered is covered by");
    expect(html).toContain("Suppliers must establish the inventory source");
    expect(html).toContain("Inventory that fails these checks is rejected or suspended");
    expect(html).not.toContain("are not screened by PryvaLogs");
    expect(html).not.toContain("you accept that risk when you buy");
  });

  it("publishes the policy in the sitemap", () => {
    expect(sitemap().some((entry) => entry.url.endsWith("/account-provenance"))).toBe(true);
  });
});
