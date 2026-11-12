// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DigitalCategoryPicker } from "@/components/dashboard/DigitalCategoryPicker";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("product type recovery", () => {
  it("waits for a throttle cooldown before retrying product types", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: "busy" }, { status: 429, headers: { "Retry-After": "6" } }))
      .mockResolvedValueOnce(Response.json({ ok: true, categories: [{ id: "games", name: "Games" }] }));
    vi.stubGlobal("fetch", fetcher);
    render(<DigitalCategoryPicker category="all" onSelect={() => undefined} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const retry = screen.getByRole("button", { name: "Retry types" });
    expect(retry).toHaveProperty("disabled", true);
    fireEvent.click(retry);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(retry).toHaveProperty("disabled", false);
    await act(async () => { fireEvent.click(retry); });
    expect(screen.getByRole("button", { name: "Games" })).toBeTruthy();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not offer a pointless retry when the catalogue is not connected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: "unconfigured" }, { status: 503, headers: { "Retry-After": "60" } })));
    render(<DigitalCategoryPicker category="all" onSelect={() => undefined} />);
    expect((await screen.findByRole("alert")).textContent).toContain("not connected yet");
    expect(screen.queryByRole("button", { name: "Retry types" })).toBeNull();
  });
});
