import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import GiftCardsPage from "@/app/(site)/gift-cards/page";
import sitemap from "@/app/sitemap";
import { formatNaira } from "@/lib/catalog";
import {
  GIFT_CARD_MAX_AMOUNT,
  GIFT_CARD_MIN_AMOUNT,
  GIFT_CARD_VALIDITY_MONTHS,
} from "@/lib/gift-card-rules";

/**
 * A gift-card page is a promise about money. These tests hold the visible copy
 * to the code that enforces it: the amount range and validity are read from the
 * same constants the API validates against, and the rules customers are most
 * likely to feel cheated by — non-refundable, one redemption, can't redeem your
 * own, no email delivery — must actually appear on the page.
 */

const html = renderToStaticMarkup(<GiftCardsPage />);
const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("gift-card explainer", () => {
  it("quotes the same amount range and validity as the checkout", () => {
    expect(text).toContain(formatNaira(GIFT_CARD_MIN_AMOUNT));
    expect(text).toContain(formatNaira(GIFT_CARD_MAX_AMOUNT));
    expect(text).toContain(`${GIFT_CARD_VALIDITY_MONTHS} months`);

    const checkout = readFileSync("src/lib/gift-cards.ts", "utf8");
    expect(checkout).toContain("GIFT_CARD_MIN_AMOUNT");
    expect(checkout).toContain("GIFT_CARD_MAX_AMOUNT");
    expect(checkout).toContain("GIFT_CARD_VALIDITY_MONTHS");
    // Hardcoding the numbers in either place is what this guards against.
    expect(checkout).not.toMatch(/amount < \d{3,}/);
  });

  it("states the rules a buyer can be disappointed by", () => {
    expect(text.toLowerCase()).toContain("not refundable");
    expect(text.toLowerCase()).toContain("one redemption");
    expect(text.toLowerCase()).toContain("except the one that bought it");
    expect(text.toLowerCase()).toContain("no partial spend");
  });

  it("does not promise to deliver the code for the buyer", () => {
    expect(text.toLowerCase()).toContain("we do not email it to the recipient");
    expect(text).not.toMatch(/we(?:'ll| will) (?:email|send) (?:it|the code) to/i);
  });

  it("does not describe gift cards as a way to withdraw money", () => {
    expect(text).toContain("Not a bank card or a withdrawal method");
  });

  it("sends a signed-out visitor through sign-in before the dashboard", () => {
    expect(html).toContain("/login?next=%2Fdashboard%2Fgift-cards");
    expect(html).not.toMatch(/href="\/dashboard\/gift-cards"/);
  });

  it("is published: listed in the sitemap and linked from the footer", () => {
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toContain("https://pryva.ng/gift-cards");

    const footer = readFileSync("src/components/site/SiteFooter.tsx", "utf8");
    expect(footer).toContain('href: "/gift-cards"');
  });
});
