// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { IntegrityConsole } from "@/app/admin/(console)/integrity/IntegrityConsole";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("integrity console", () => {
  it("reads the API's summary envelope and reports checked records", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      scope: "all",
      summary: { users: { checked: 3, issues: 1 }, orders: { checked: 4, issues: 0 } },
      generatedAt: "2026-11-06T18:00:00.000Z",
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    render(<IntegrityConsole />);
    fireEvent.click(screen.getByRole("button", { name: "Run integrity check" }));
    await waitFor(() => expect(screen.getByText("Wallets checked")).toBeTruthy());
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("1 issue found")).toBeTruthy();
    expect(screen.getByText("Orders checked")).toBeTruthy();
    expect(screen.getByText("4")).toBeTruthy();
    expect(screen.getByText("0 issues found")).toBeTruthy();
  });

  it("shows an error instead of rendering an incomplete result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, error: "Check unavailable" }), { status: 500 })));
    render(<IntegrityConsole />);
    fireEvent.click(screen.getByRole("button", { name: "Run integrity check" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Check unavailable"));
    expect(screen.queryByText("Wallets checked")).toBeNull();
  });
});
