import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn((path: string): never => { throw new Error(`redirect:${path}`); }));
vi.mock("next/navigation", () => ({ redirect }));
import DigitalCatalogPage from "@/app/dashboard/digital-catalog/page";

describe("legacy catalogue entry points", () => {
  it("opens the shared service hub from old digital catalogue links", () => {
    expect(() => DigitalCatalogPage()).toThrow("redirect:/dashboard/services");
  });

});
