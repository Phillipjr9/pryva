// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { InboxManager } from "@/app/dashboard/inbox/InboxManager";

const address = `${"long-disposable-address-".repeat(5)}@example.com`;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("saved inbox responsive layout", () => {
  it("keeps a wrapping address and touch-sized actions in separate grid cells", async () => {
    const copy = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        configured: true,
        inboxes: [{ id: "saved", address, status: "saved", createdAt: "2026-10-31T00:00:00Z" }],
      }),
    }));
    render(<InboxManager />);
    const actions = await screen.findByRole("group", { name: `Actions for ${address}` });
    const row = actions.closest("li")!;
    expect(row.className).toContain("grid-cols-1");
    expect(row.className).toContain("xl:grid-cols-[minmax(0,1fr)_auto]");
    expect(within(row).getByText(address).className).toContain("[overflow-wrap:anywhere]");
    expect(actions.className).toContain("flex-wrap");
    for (const title of ["Copy address", "Delete inbox"]) {
      const button = within(actions).getByTitle(title);
      expect(button.className).toContain("min-h-11");
      expect(button.className).toContain("min-w-11");
    }
    fireEvent.click(within(actions).getByTitle("Copy address"));
    expect(copy).toHaveBeenCalledWith(address);
    expect(within(actions).getByRole("button", { name: "Use this inbox" })).toBeTruthy();
  });
});
