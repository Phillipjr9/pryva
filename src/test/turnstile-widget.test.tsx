// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

/**
 * The widget's contract with the form.
 *
 * A Turnstile token is single-use and short-lived. Every way one can die —
 * expiry, a Cloudflare error, a timeout, a refused submit, a script blocker —
 * has to reach the form as `null`, or the form keeps its submit button enabled
 * around a token the server will refuse. That is the bug this file exists to
 * prevent, and it is invisible in a screenshot.
 */

const hoisted = vi.hoisted(() => ({ onLoad: null as null | (() => void), onError: null as null | (() => void) }));

vi.mock("next/script", () => ({
  default: ({ onLoad, onError }: { onLoad?: () => void; onError?: () => void }) => {
    hoisted.onLoad = onLoad ?? null;
    hoisted.onError = onError ?? null;
    return null;
  },
}));

import { TurnstileWidget } from "@/components/auth/TurnstileWidget";

type Options = {
  sitekey: string;
  callback: (token: string) => void;
  "error-callback": () => void;
  "expired-callback": () => void;
  "timeout-callback": () => void;
};

let options: Options | null = null;
const api = {
  render: vi.fn((_element: HTMLElement, opts: Options) => { options = opts; return "widget-1"; }),
  reset: vi.fn(),
  remove: vi.fn(),
};

beforeEach(() => {
  options = null;
  hoisted.onLoad = null;
  hoisted.onError = null;
  api.render.mockClear();
  api.reset.mockClear();
  api.remove.mockClear();
  window.turnstile = api;
});

afterEach(() => {
  cleanup();
  delete window.turnstile;
});

describe("TurnstileWidget", () => {
  it("renders once with the site key it was given", () => {
    const onToken = vi.fn();
    const { rerender } = render(<TurnstileWidget siteKey="site-key-123" onToken={onToken} />);
    expect(api.render).toHaveBeenCalledTimes(1);
    expect(options?.sitekey).toBe("site-key-123");

    // A keystroke in the parent re-renders this component. Re-creating the
    // widget on every one would throw away a solved challenge mid-form.
    rerender(<TurnstileWidget siteKey="site-key-123" onToken={vi.fn()} />);
    expect(api.render).toHaveBeenCalledTimes(1);
  });

  it("waits for the script when it has not loaded yet", () => {
    delete window.turnstile;
    render(<TurnstileWidget siteKey="key" onToken={vi.fn()} />);
    expect(api.render).not.toHaveBeenCalled();

    window.turnstile = api;
    act(() => { hoisted.onLoad?.(); });
    expect(api.render).toHaveBeenCalledTimes(1);
  });

  it("renders on mount when the script is already cached", () => {
    // next/script does not call onLoad for a script it has already loaded, so a
    // visitor returning to /signup would otherwise see an empty slot forever.
    render(<TurnstileWidget siteKey="key" onToken={vi.fn()} />);
    expect(hoisted.onLoad).toBeTruthy();
    expect(api.render).toHaveBeenCalledTimes(1);
  });

  it("reports the token when the challenge is solved", () => {
    const onToken = vi.fn();
    render(<TurnstileWidget siteKey="key" onToken={onToken} />);
    act(() => { options?.callback("solved-token"); });
    expect(onToken).toHaveBeenLastCalledWith("solved-token");
  });

  it("reports null on expiry, error and timeout", () => {
    const onToken = vi.fn();
    render(<TurnstileWidget siteKey="key" onToken={onToken} />);

    act(() => { options?.callback("solved-token"); });
    act(() => { options?.["expired-callback"](); });
    expect(onToken).toHaveBeenLastCalledWith(null);

    act(() => { options?.callback("second-token"); });
    act(() => { options?.["timeout-callback"](); });
    expect(onToken).toHaveBeenLastCalledWith(null);

    act(() => { options?.["error-callback"](); });
    expect(onToken).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("alert").textContent).toMatch(/could not load/i);
  });

  it("asks Cloudflare for a fresh challenge when the form resets it", () => {
    const onToken = vi.fn();
    const { rerender } = render(<TurnstileWidget siteKey="key" onToken={onToken} resetSignal={0} />);
    act(() => { options?.callback("spent-token"); });

    rerender(<TurnstileWidget siteKey="key" onToken={onToken} resetSignal={1} />);
    expect(api.reset).toHaveBeenCalledWith("widget-1");
    // The spent token must not stay in the form while the new challenge runs.
    expect(onToken).toHaveBeenLastCalledWith(null);
  });

  it("does not reset on first mount", () => {
    render(<TurnstileWidget siteKey="key" onToken={vi.fn()} />);
    expect(api.reset).not.toHaveBeenCalled();
  });

  it("removes the widget when the auth card unmounts", () => {
    const { unmount } = render(<TurnstileWidget siteKey="key" onToken={vi.fn()} />);
    unmount();
    expect(api.remove).toHaveBeenCalledWith("widget-1");
  });

  it("tells the visitor when a script blocker stopped the challenge", () => {
    const onToken = vi.fn();
    delete window.turnstile;
    render(<TurnstileWidget siteKey="key" onToken={onToken} />);
    act(() => { hoisted.onError?.(); });
    expect(onToken).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("alert").textContent).toMatch(/script blocker/i);
  });

  it("survives a provider API that throws, and leaves no usable token", () => {
    const onToken = vi.fn();
    api.render.mockImplementationOnce(() => { throw new Error("boom"); });
    expect(() => render(<TurnstileWidget siteKey="key" onToken={onToken} />)).not.toThrow();
    // No token means the form's submit stays disabled — a broken widget is not
    // a way past the challenge.
    expect(onToken).toHaveBeenLastCalledWith(null);
  });
});
