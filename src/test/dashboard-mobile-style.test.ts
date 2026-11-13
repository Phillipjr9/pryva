import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const money = readFileSync("src/components/dashboard/MoneyFlow.module.css", "utf8");
const support = readFileSync("src/components/site/SupportFloatButton.tsx", "utf8");

describe("short-screen dashboard layouts", () => {
  it("keeps the wallet dialog scrollable and its phone controls readable and touch-sized", () => {
    expect(money).toContain("max-height: calc(100dvh - 16px)");
    const phone = money.slice(money.indexOf("@media (max-width: 520px)"), money.indexOf("@media (max-width: 380px)"));
    expect(phone).toMatch(/\.steps\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(phone).toMatch(/\.step\s*\{[^}]*font-size:\s*12px/);
    // Close is a text control now: it keeps a 44px minimum height and enough
    // width for the word at every width, not just on phones.
    expect(money).toMatch(/\.close\s*\{[^}]*min-width:\s*64px;[^}]*min-height:\s*44px/);
    expect(phone).toMatch(/\.preset\s*\{[^}]*min-height:\s*44px/);
    const narrow = money.slice(money.indexOf("@media (max-width: 380px)"));
    // A negative sticky bottom cut the primary action off at 320px.
    expect(narrow).toMatch(/\.actions\s*\{[^}]*position:\s*sticky;\s*bottom:\s*0/);
  });

  it("keeps floating help above the tabs through tablet widths and bounds its panel to the visible viewport", () => {
    expect(support).toContain("bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] lg:bottom-5");
    expect(support).toContain("max-h-[62dvh]");
    expect(support).toContain("sm:max-h-[54dvh]");
    expect(support).toContain('aria-label="Close support chat"');
  });
});
