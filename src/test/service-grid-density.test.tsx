// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { ServiceExplorer } from "@/components/dashboard/ServiceExplorer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

afterEach(() => cleanup());

// jsdom rewrites `import.meta.url`, so resolve from the project root instead.
const read = (relative: string) => readFileSync(join(process.cwd(), "src", relative), "utf8");

/**
 * Choosing a service on a phone.
 *
 * Reported: "on mobile the grid is too big for mobile selections". Two frames
 * were the cause: the overview stacked eight full-width service rows, and the
 * hub put two ~260 px cards side by side at 375 px, so a handful of services
 * filled several screens. The fix is density, not smaller type — the phone
 * floor stays at 13 px (`mobile-layout.test.tsx`).
 *
 * These assertions are on the responsive classes and on the rendered card,
 * because the failure is only visible at 320–430 px, which this suite cannot
 * open. Both grids start single-column and only go multi-column at `sm`.
 */
describe("selecting a service on a phone", () => {
  it("gives each hub card one compact phone row, not a squeezed two-up card", () => {
    const source = read("components/dashboard/ServiceExplorer.tsx");
    expect(source).toContain("mt-3 grid grid-cols-1 gap-2 sm:mt-4 sm:grid-cols-2 sm:gap-3 xl:grid-cols-3");
    // The old phone layout: two full cards per row at 375px.
    expect(source).not.toMatch(/grid grid-cols-2 gap-2\.5/);
  });

  it("keeps the long card detail for sm and up instead of dropping it", () => {
    const source = read("components/dashboard/ServiceExplorer.tsx");
    // Coverage, units and the labelled action are hidden on phones only.
    expect(source).toContain('className="hidden sm:mt-2 sm:block"><UnitsStatus');
    expect(source).toContain("hidden min-h-[1.2rem] text-meta font-semibold text-ink sm:block");
    // The phone control is still a 44px target and keeps its accessible name.
    expect(source).toContain("aria-label={action.label}");
    expect(source).toContain("grid h-11 w-11 place-items-center");
  });

  it("renders one heading and one control per service, never a hidden duplicate", () => {
    render(<ServiceExplorer initialCountry="ng" initialCategory="numbers" />);
    const heading = screen.getByRole("heading", { name: "Nigeria" });
    const card = heading.closest("article")!;
    expect(within(card).getAllByRole("heading")).toHaveLength(1);
    expect(within(card).getAllByRole("link")).toHaveLength(1);
    // The phone line carries type and price on a single row.
    const phoneLine = [...card.querySelectorAll("p")].find(
      (line) => line.className.includes("sm:hidden") && line.textContent?.includes("Single use · ₦"),
    );
    expect(phoneLine, "the compact phone line is missing").toBeTruthy();
  });

  it("puts the overview's eight services in compact tiles, three or four per row", () => {
    const page = read("app/dashboard/page.tsx");
    expect(page).toContain("Select a service");
    expect(page).toContain("grid grid-cols-3 gap-1.5 min-[400px]:grid-cols-4 sm:grid-cols-2 sm:gap-2");
    // The old phone layout stacked every service full width.
    expect(page).not.toContain("mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2");
  });
});
