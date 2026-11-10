// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ configured: true, eventLimit: 100, traffic: { status: "unavailable" }, events: { status: "ready", data: [{ datetime: "2026-01-01T12:00:00Z", action: "block", source: "waf", country: "US", ip: "192.0.2.1", path: "/signup" }] } })));
    render(<CloudflareSecurity />);
    expect(await screen.findByText("/signup")).toBeTruthy();
    expect(screen.getByText(/Traffic analytics unavailable/)).toBeTruthy();
    expect(screen.getByText(/Blocking controls are not connected/)).toBeTruthy();
  });
});
