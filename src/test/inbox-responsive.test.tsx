// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { InboxManager } from "@/app/dashboard/inbox/InboxManager";

const address = `${"long-disposable-address-".repeat(5)}@example.com`;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("switching inboxes", () => {
  it("ignores an old poll that finishes after a different inbox becomes active", async () => {
    let finishOld!: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
    const oldPoll = new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve) => { finishOld = resolve; });
    const active = { id: "first", address: "first@example.test", status: "active", createdAt: "2026-10-31T00:00:00Z" };
    const saved = { id: "second", address: "second@example.test", status: "saved", createdAt: "2026-10-31T00:00:00Z" };
    const response = (value: unknown) => ({ ok: true, json: async () => value });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/inbox") return response({ ok: true, configured: true, inboxes: [active, saved] });
      if (url === "/api/inbox/select") return response({ ok: true, inbox: { ...saved, status: "active" } });
      if (url === "/api/inbox/poll") {
        const id = JSON.parse(String(init?.body)).inboxId;
        return id === "first" ? oldPoll : response({ ok: true, code: "222222", messages: [] });
      }
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<InboxManager />);
    await screen.findAllByText("first@example.test");
    // Start the first request manually, independently of visibility polling.
    fireEvent.click(screen.getByRole("button", { name: "Check mail" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === "/api/inbox/poll")).toBe(true));
    const secondActions = screen.getByRole("group", { name: "Actions for second@example.test" });
    fireEvent.click(within(secondActions).getByRole("button", { name: "Use this inbox" }));
    expect(await screen.findByText("222222")).toBeTruthy();
    await act(async () => {
      finishOld(response({ ok: true, code: "111111", messages: [{ subject: "Old message" }] }));
      await oldPoll;
    });
    expect(screen.queryByText("111111")).toBeNull();
    expect(screen.queryByText("Old message")).toBeNull();
    expect(screen.getByText("222222")).toBeTruthy();
  });
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
