// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import NotFound from "@/app/not-found";
import { NotFoundScene } from "@/components/not-found/NotFoundScene";

/**
 * The 404 is the one page nobody asks for, so it is checked for three things:
 * it explains itself, it offers the two exits people actually want, and the
 * cartoon is decoration rather than content — a screen reader should get the
 * words, not a walk through a drawing.
 */

afterEach(cleanup);

describe("the 404 page", () => {
  it("says what happened and where to go instead", () => {
    render(<NotFound />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("floated away");
    expect(screen.getByText(/wallet, orders and boosts are exactly where you left them/i)).toBeTruthy();

    const links = Object.fromEntries(
      screen.getAllByRole("link").map((link) => [link.textContent?.trim() ?? "", link.getAttribute("href")]),
    );
    expect(links).toMatchObject({ "Back home": "/", "Go to dashboard": "/dashboard", "Help centre": "/help" });
    expect(Object.values(links)).toContain("/contact");
  });

  it("keeps the cartoon decorative", () => {
    const { container } = render(<NotFoundScene />);
    const root = container.firstElementChild!;
    expect(root.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe("0 0 720 400");
    // Nothing on an error page should wait on the network.
    expect(container.querySelectorAll("image")).toHaveLength(0);
    expect(container.innerHTML).not.toMatch(/https?:\/\//);
  });

  it("actually animates, and every animated class has a keyframe behind it", () => {
    const { container } = render(<NotFoundScene />);
    const classes = new Set(
      [...container.querySelectorAll("[class]")]
        .flatMap((node) => (node.getAttribute("class") ?? "").split(/\s+/))
        .filter((name) => name.startsWith("nf-")),
    );
    // The astronaut bobs, the stars twinkle, the eyes blink, the arm waves,
    // the digits drift, the tether crawls and a rocket crosses the sky.
    expect([...classes].sort()).toEqual(
      expect.arrayContaining(["nf-blink", "nf-bob", "nf-drift", "nf-rocket", "nf-trail", "nf-twinkle", "nf-wave"]),
    );
    expect(container.querySelectorAll(".nf-twinkle").length).toBeGreaterThan(15);

    const css = readFileSync("src/app/globals.css", "utf8");
    for (const name of classes) {
      expect(css, `${name} has no rule in globals.css`).toMatch(new RegExp(`\\.${name}\\s*\\{`));
      expect(css, `${name} is not animated`).toMatch(new RegExp(`\\.${name}\\s*\\{[^}]*animation:`));
    }
  });

  it("stops moving for anyone who asked it to", () => {
    // The whole scene is CSS animation, so the global switch is the only thing
    // needed — but it has to still be there, and still cover pseudo-elements.
    const css = readFileSync("src/app/globals.css", "utf8");
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(block).toContain("animation-duration: 0.001ms !important");
    expect(block).toContain("animation-iteration-count: 1 !important");
  });
});
