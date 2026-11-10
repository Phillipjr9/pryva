import { describe, expect, it, vi } from "vitest";
const redirect = vi.hoisted(() => vi.fn((path: string): never => { throw new Error(`redirect:${path}`); }));
vi.mock("next/navigation", () => ({ redirect }));
import EsimCataloguePage from "@/app/dashboard/esim/page";

describe("legacy eSIM catalogue link", () => {
  it("opens the unified eSIM category with all destinations enabled", () => {
    expect(() => EsimCataloguePage()).toThrow("redirect:/dashboard/services?category=esim&allDestinations=1");
  });
});
