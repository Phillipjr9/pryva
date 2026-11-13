// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ServiceExplorer } from "@/components/dashboard/ServiceExplorer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("marketplace entry", () => {
  it("starts with grouped services and links directly to paid accounts and the free inbox", () => {
    window.history.replaceState(null, "", "/dashboard/services?country=us");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true, country: "us", live: true, items: [] })));
    render(<ServiceExplorer initialCountry="us" initialCategory={null} />);
    expect(screen.getByRole("heading", { level: 1, name: "Marketplace" })).toBeTruthy();
    const service = screen.getByRole("heading", { name: "Choose a service" });
    const country = screen.getByRole("heading", { name: "Country for relevant offers" });
    expect(service.compareDocumentPosition(country) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const picker = screen.getByRole("combobox", { name: "Service category" });
    expect(within(picker).getByRole("group", { name: "Digital products & accounts" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Browse account listings" }).getAttribute("href")).toBe("/dashboard/accounts");
    expect(screen.getByRole("link", { name: "open the temporary inbox" }).getAttribute("href")).toBe("/dashboard/inbox");
    fireEvent.change(picker, { target: { value: "accounts" } });
    expect(screen.getByRole("link", { name: "Browse account listings" }).getAttribute("href")).toBe("/dashboard/accounts");
    expect(new URLSearchParams(window.location.search).get("country")).toBe("us");
  });

  it("shows local flag artwork for the selected and quick-choice countries, including other ISO countries", () => {
    window.history.replaceState(null, "", "/dashboard/services?country=ng");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ok: true, country: "ng", live: true, items: [] })));
    render(<ServiceExplorer initialCountry="ng" initialCategory="numbers" />);
    const select = screen.getByRole("combobox", { name: "Country of service" });
    const selectedFlag = () => select.parentElement!.querySelector("img")!;
    expect(selectedFlag().getAttribute("src")).toBe("/images/flags/ng.svg");
    expect(within(screen.getByRole("button", { name: "US" })).getByRole("presentation").getAttribute("src")).toBe("/images/flags/us.svg");
    fireEvent.change(select, { target: { value: "bj" } });
    expect(selectedFlag().getAttribute("src")).toBe("/images/flags/bj.svg");
    expect(select).toHaveProperty("value", "bj");
  });
});
