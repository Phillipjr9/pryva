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
    expect(digitalArtwork("Wild Rift Coins")?.key).toBe("wild-rift");
    expect(digitalArtwork("Clash Royale gems")?.key).toBe("clash-royale");
    expect(digitalArtwork("Spotify Premium")?.key).toBe("spotify");
    expect(digitalArtwork("PUBG Mobile")?.key).toBe("pubg");
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
  it("uses bundled brand marks and a neutral fallback for unknown products", () => {
    const { container, rerender } = render(<DigitalProductIcon name="PUBG Mobile" />);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/digital-brand-icons/pubg.svg");
    rerender(<DigitalProductIcon name="Mystery product" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).toBeTruthy();
  });
});
