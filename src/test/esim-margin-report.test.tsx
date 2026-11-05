// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const rows = vi.hoisted(() => ({ value: [] as unknown[] }));
vi.mock("@/lib/identity/auth", () => ({ requireAdmin: async () => ({ id: "admin" }) }));
vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ orderBy: () => ({ limit: async () => rows.value }) }) }) },
}));

import AdminMarginPage from "@/app/admin/(console)/margin/page";

afterEach(() => { cleanup(); rows.value = []; });

describe("eSIM estimates in margin reporting", () => {
  it("does not treat a quoted eSIM cost as a confirmed supplier expense", async () => {
    rows.value = [
      { slug: "esim-nigeria", service: "esim", name: "eSIM plan", amount: 9_800, cost: 7_200, status: "active" },
      { slug: "number-plan", service: "numbers", name: "Number plan", amount: 100, cost: 70, status: "active" },
    ];
    render(await AdminMarginPage());
    expect(screen.getByText(/eSIM estimates are excluded until actual costs/i)).toBeTruthy();
    expect(screen.getByText("Number plan")).toBeTruthy();
    expect(screen.getByText(/no usable cost in this report: esim-nigeria/i)).toBeTruthy();
    expect(screen.queryByText("₦9,800")).toBeNull();
    expect(screen.queryByText("₦7,200")).toBeNull();
  });
});
