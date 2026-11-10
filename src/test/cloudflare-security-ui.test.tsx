// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CloudflareSecurity } from "@/app/admin/(console)/security/CloudflareSecurity";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("Cloudflare security panel", () => {
  it("makes clear that Turnstile is not an analytics connection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ configured: false, eventLimit: 100 })));
    render(<CloudflareSecurity />);
    expect(await screen.findByText(/Cloudflare analytics not connected/)).toBeTruthy();
    expect(screen.getByText(/Turnstile uses separate credentials/)).toBeTruthy();
  });
  it("distinguishes an unavailable feed from no events and shows actual event data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ configured: true, eventLimit: 100, traffic: { status: "unavailable" }, events: { status: "ready", data: [{ datetime: new Date().toISOString(), action: "block", source: "waf", country: "US", ip: "192.0.2.1", path: "/signup" }] } })));
    render(<CloudflareSecurity />);
    expect(await screen.findByText("/signup")).toBeTruthy();
    expect(screen.getByText(/Traffic analytics unavailable/)).toBeTruthy();
    expect(screen.getByText(/Blocking controls are not connected/)).toBeTruthy();
  });
  it("filters only the loaded events by country, action, path, IP and auth paths", async () => {
    const now = new Date().toISOString();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ configured: true, eventLimit: 100, events: { status: "ready", data: [
      { datetime: now, action: "block", source: "waf", country: "US", ip: "192.0.2.1", path: "/api/auth/signup" },
      { datetime: now, action: "managed_challenge", source: "botFight", country: "GB", ip: "192.0.2.2", path: "/search" },
    ] }, trafficBreakdown: { status: "ready", data: { countries: [{ label: "US", count: 70 }], paths: [], statuses: [] } }, securityBreakdown: { status: "ready", data: { actions: [{ label: "block", count: 12 }], services: [], rules: [] } } })));
    render(<CloudflareSecurity />);
    expect(await screen.findByText("/api/auth/signup")).toBeTruthy();
    expect(screen.getByText("70")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Country"), { target: { value: "US" } });
    expect(screen.queryByText("/search")).toBeNull();
    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "block" } });
    fireEvent.change(screen.getByLabelText("IP, path or service"), { target: { value: "192.0.2.1" } });
    fireEvent.click(screen.getByLabelText("Signup / login paths"));
    expect(screen.getByText("/api/auth/signup")).toBeTruthy();
    expect(screen.getByText("Showing 1 of 2 loaded events.")).toBeTruthy();
    expect(screen.getByText(/not successful signups/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("IP, path or service"), { target: { value: "not-present" } });
    expect(screen.getByText("No loaded events match these filters.")).toBeTruthy();
  });

});
