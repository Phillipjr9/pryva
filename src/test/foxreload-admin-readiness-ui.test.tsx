// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FoxreloadCheck } from "@/app/admin/(console)/foxreload/FoxreloadCheck";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("FoxReload admin readiness display", () => {
  it("performs a read-only check on request and reports gated sales honestly", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, configured: true, account: { active: true, funds: { usd: "positive", rub: "zero" }, returnedBalances: 2, returnedCurrencies: ["RUB", "USD"] }, error: null, settings: { purchasesBlockedInEnvironment: true, mock: false, rateConfigured: false, intentSecretConfigured: false, starsEnabled: false, codesEnabled: false, topupsEnabled: false, loginTopupsEnabled: false, confirmationsEnabled: false, esimsEnabled: false, reviewedCodes: 0, reviewedDirectTopups: 0, reviewedLoginTopups: 0, reviewedEsims: 0 } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<FoxreloadCheck />);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Check account and settings" }));
    expect(await screen.findByText(/Authenticated and active/)).toBeTruthy();
    expect(screen.getByText(/Purchases blocked in this environment/)).toBeTruthy();
    expect(screen.getByText(/Codes: Disabled; 0 reviewed offers/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/foxreload", { cache: "no-store" });
  });
  it("does not relay unexpected error content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "private" }) }));
    render(<FoxreloadCheck />);
    fireEvent.click(screen.getByRole("button", { name: "Check account and settings" }));
    expect((await screen.findByRole("alert")).textContent).not.toContain("private");
  });
});
