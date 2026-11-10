// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DigitalProductIcon } from "@/components/DigitalProductIcon";
import { digitalArtwork, parseDigitalArtwork } from "@/lib/content/digital-artwork";

afterEach(cleanup);
describe("curated digital product artwork", () => {
  it("recognizes distinct product families using bounded names and slugs", () => {
    expect(digitalArtwork("80 + 8 CP", "call-of-duty-mobile-activision-us-80-plus-8-cp")).toEqual({ kind: "local", key: "call-of-duty-mobile" });
    expect(digitalArtwork("Call of Duty Mobile Garena 100 CP")).toEqual({ kind: "local", key: "call-of-duty-mobile" });
    expect(digitalArtwork("Arena Breakout: Infinite")).toEqual({ kind: "category", key: "arena-breakout-infinite" });
    expect(digitalArtwork("Arena Breakout bonds")).toEqual({ kind: "category", key: "arena-breakout" });
    expect(digitalArtwork("Genshin Impact Crystals")?.key).toBe("genshin-impact");
    expect(digitalArtwork("Likee Diamonds 100")).toEqual({ kind: "local", key: "likee" });
    expect(digitalArtwork("100 Diamonds", "likee-100-diamonds")).toEqual({ kind: "local", key: "likee" });
    expect(digitalArtwork("Likee Other Brand Gift Card 100", "likee-100-diamonds")).toBeNull();
    expect(digitalArtwork("Likeeworthy unrelated")).toBeNull();
    expect(digitalArtwork("Wild Rift Coins")?.key).toBe("wild-rift");
    expect(digitalArtwork("Clash Royale gems")?.key).toBe("clash-royale");
    expect(digitalArtwork("Spotify Premium")?.key).toBe("spotify");
    expect(digitalArtwork("PUBG Mobile")?.key).toBe("pubg");
    expect(digitalArtwork("PS Store code for $50 (USA)")).toEqual({ kind: "brand", key: "playstation" });
    expect(digitalArtwork("PS Store Partner Gift Card 10 USD")).toBeNull();
    expect(digitalArtwork("3550 Coins (40% more value)")).toBeNull();
    expect(digitalArtwork("KEY 10$ — flexible donation code")).toBeNull();
    expect(digitalArtwork("AstroPay Gift Card 40 BDT (BD)")).toEqual({ kind: "local", key: "astropay" });
    expect(digitalArtwork("Nike Gift Card 100 EUR (Germany)")).toEqual({ kind: "indexed", key: "nike" });
    expect(digitalArtwork("100 EUR (Germany)", "cw-airbnb-100-eur-germany")).toEqual({ kind: "indexed", key: "airbnb" });
    expect(digitalArtwork("YouTube Music Gift Card 10 USD")?.key).toBe("youtubemusic");
    expect(digitalArtwork("Amazon Prime Video Gift Card 10 USD", "cw-nike-10-usd-us")).toBeNull();
    expect(digitalArtwork("Apple Music 1 month")?.key).toBe("applemusic");
    expect(digitalArtwork("YouTube Music 1 month")?.key).toBe("youtubemusic");
    expect(digitalArtwork("Call of Duty Xbox 500 Points")).toBeNull();
    expect(digitalArtwork("Not Spotify", "unknown-spotify")).toBeNull();
    expect(digitalArtwork("Robloxian unrelated")).toBeNull();
  });
  it("identifies game, membership and Xbox gift cards without confusing platform and product", () => {
    expect(digitalArtwork("Apex Legends 4350 Coins (Xbox)", "apex-legends-xbox-4350-coins")).toEqual({ kind: "local", key: "apex-legends" });
    expect(digitalArtwork("EA SPORTS FC 26 - 1050 FC Points (PC)")).toEqual({ kind: "local", key: "ea-fc-26" });
    expect(digitalArtwork("EA SPORTS FC 25 - 1050 FC Points (PC)")).toBeNull();
    expect(digitalArtwork("Nintendo Switch Online 3 Month Individual Membership (USA)")).toEqual({ kind: "local", key: "nintendo-switch-online" });
    expect(digitalArtwork("Xbox Gift Card | Brazil")).toEqual({ kind: "brand", key: "xbox" });
    expect(digitalArtwork("10 USD Xbox Gift Card (USA)")).toEqual({ kind: "brand", key: "xbox" });
    expect(digitalArtwork("$10 Xbox Gift Card (USA)")).toEqual({ kind: "brand", key: "xbox" });
    expect(digitalArtwork("Apex Legends Partner Gift Card 10 USD")).toBeNull();
    expect(digitalArtwork("Another game (Xbox)", "xbox-another-game")).toBeNull();
    expect(digitalArtwork("Xbox Other Game Gift Card")).toBeNull();
    for (const key of ["apex-legends", "ea-fc-26", "nintendo-switch-online"]) {
      expect(parseDigitalArtwork({ kind: "local", key })).toEqual({ kind: "local", key });
    }
  });
  it("renders the new locally bundled game and membership images", () => {
    const { container, rerender } = render(<DigitalProductIcon name="Apex Legends 4350 Coins (Xbox)" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/digital-brand-icons/apex-legends.png");
    rerender(<DigitalProductIcon name="EA SPORTS FC 26 - 1050 FC Points (PC)" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/digital-brand-icons/ea-fc-26.png");
    rerender(<DigitalProductIcon name="Nintendo Switch Online 3 Month Individual Membership (USA)" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/digital-brand-icons/nintendo-switch-online.png");
  });
  it("uses bundled marks for the supplied Netflix cards and PS Store codes", () => {
    expect(digitalArtwork("Netflix Gift Card 100 EUR Key EUROPE")).toEqual({ kind: "brand", key: "netflix" });
    expect(digitalArtwork("Netflix Gift Card 20 USD Key")).toEqual({ kind: "brand", key: "netflix" });
    expect(digitalArtwork("Netflix Gift Card 50 USD (USA)")).toEqual({ kind: "brand", key: "netflix" });
    expect(digitalArtwork("Netflix Other Brand Gift Card 10 USD")).toBeNull();
    for (const name of ["PS Store code for 360R$ (Brazil)", "PS Store Code for 120£ (United Kingdom)", "PS Store code for $200 (USA)", "PS Store code for 5000₺ (Turkey)"]) {
      expect(digitalArtwork(name)).toEqual({ kind: "brand", key: "playstation" });
    }
  });
  it("identifies iTunes and Nintendo eShop cards separately and serves Google Play locally", () => {
    expect(digitalArtwork("iTunes 2500 INR (India) IN Official")).toEqual({ kind: "simple", key: "itunes" });
    expect(digitalArtwork("iTunes 1500 TRY (Turkey)")).toEqual({ kind: "simple", key: "itunes" });
    expect(digitalArtwork("Apple iTunes Gift Card 30 USD Key (USA)", "apple-itunes-gift-card-30-usd")).toEqual({ kind: "simple", key: "itunes" });
    expect(digitalArtwork("iTunes 200 INR Partner Gift Card")).toBeNull();
    expect(digitalArtwork("Apple iTunes Partner Gift Card 30 USD")).toBeNull();
    expect(digitalArtwork("Nintendo eShop Card 150 BRL Key (Brazil)")).toEqual({ kind: "local", key: "nintendo-eshop" });
    expect(digitalArtwork("Nintendo eShop Card 9000 JPY Key (Japan)")).toEqual({ kind: "local", key: "nintendo-eshop" });
    expect(digitalArtwork("Nintendo Other Gift Card")).toBeNull();
    expect(digitalArtwork("Google Play Gift Card 50 TRY Key TURKEY")).toEqual({ kind: "simple", key: "googleplay" });
    expect(digitalArtwork("Google Play Partner Gift Card 50 TRY")).toBeNull();
    expect(parseDigitalArtwork({ kind: "simple", key: "itunes" })).toEqual({ kind: "simple", key: "itunes" });
    expect(parseDigitalArtwork({ kind: "local", key: "nintendo-eshop" })).toEqual({ kind: "local", key: "nintendo-eshop" });
    const { container, rerender } = render(<DigitalProductIcon name="Apple iTunes Gift Card 30 USD" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/digital-brand-icons/itunes.svg");
    rerender(<DigitalProductIcon name="Nintendo eShop Card 150 BRL" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/digital-brand-icons/nintendo-eshop.png");
    rerender(<DigitalProductIcon name="Google Play Gift Card 50 TRY" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/digital-brand-icons/googleplay.svg");
  });
  it("uses the bundled Razer and Battle.net marks for their named gift cards", () => {
    expect(digitalArtwork("RAZER GOLD Gift Card 10 EUR - Europe")).toEqual({ kind: "brand", key: "razer" });
    expect(digitalArtwork("Razer Gold Gift Card 50 INR Key INDIA")).toEqual({ kind: "brand", key: "razer" });
    expect(digitalArtwork("Razer Gold Partner Gift Card 10 USD")).toBeNull();
    expect(digitalArtwork("BLIZZARD Gift Card 50 USD Official (USA)")).toEqual({ kind: "brand", key: "battledotnet" });
    expect(digitalArtwork("Battle.net Gift Card 20 EUR (EU) Key")).toEqual({ kind: "brand", key: "battledotnet" });
    expect(digitalArtwork("Blizzard Game Gift Card 50 USD")).toBeNull();
    expect(digitalArtwork("Battle.net Partner Gift Card 20 EUR")).toBeNull();
  });
  it("recognizes explicitly named Steam Wallet cards without claiming partner cards or data plans", () => {
    for (const name of ["Steam Wallet Gift Card 30$ — digital code", "Steam Wallet Gift Card 130 INR (Key India)", "Steam Wallet Gift Card 5 EUR (Europe)", "Steam Gift Card 50 USD"]) {
      expect(digitalArtwork(name)).toEqual({ kind: "brand", key: "steam" });
    }
    expect(digitalArtwork("Steam Wallet Partner Gift Card 50 USD")).toBeNull();
    expect(digitalArtwork("1 GB / 7 days")).toBeNull();
    expect(digitalArtwork("10 GB / 30 days")).toBeNull();
    expect(digitalArtwork("unlimited internet 1 GB/day / 15 days")).toBeNull();
  });
  it("only accepts artwork from the fixed registry", () => {
    expect(parseDigitalArtwork({ kind: "category", key: "../../tracker" })).toBeNull();
    expect(parseDigitalArtwork({ kind: "brand", key: "__proto__" })).toBeNull();
    expect(parseDigitalArtwork({ kind: "indexed", key: "../../evil" })).toBeNull();
    expect(parseDigitalArtwork({ kind: "simple", key: "https://evil.test/a.svg" })).toBeNull();
  });
  it("renders selected artwork without a referrer and falls back if loading fails", () => {
    const { container } = render(<DigitalProductIcon name="Call of Duty Mobile" />);
    const image = container.querySelector("img")!;
    expect(image.getAttribute("src")).toBe("/digital-brand-icons/call-of-duty-mobile.png");
    expect(image.getAttribute("referrerpolicy")).toBe("no-referrer");
    fireEvent.error(image);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });
  it("serves Likee's bundled mark rather than the supplier artwork proxy", () => {
    const { container } = render(<DigitalProductIcon name="Likee Diamonds 100" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/verification-logos/social-likee.png");
    expect(parseDigitalArtwork({ kind: "local", key: "likee" })).toEqual({ kind: "local", key: "likee" });
  });
  it("uses bundled brand marks and a neutral fallback for unknown products", () => {
    const { container, rerender } = render(<DigitalProductIcon name="PUBG Mobile" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/digital-brand-icons/pubg.svg");
    rerender(<DigitalProductIcon name="Mystery product" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toBeTruthy();
  });
});
