import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const worker = readFileSync(fileURLToPath(new URL("../../public/preview-demo-bridge.js", import.meta.url)), "utf8");
const token = "a".repeat(64);

function setup() {
  const listeners: Record<string, (event: never) => void> = {};
  const stored = new Map<string, string>();
  const cache = {
    match: vi.fn(async (key: string) => stored.has(key) ? new Response(stored.get(key)) : undefined),
    put: vi.fn(async (key: string, value: Response) => { stored.set(key, await value.text()); }),
    delete: vi.fn(async (key: string) => stored.delete(key)),
  };
  const network = vi.fn(async (_request: Request) => new Response("ok"));
  const context = {
    self: {
      location: { origin: "https://3100-abc123.e2b.app" },
      clients: { claim: vi.fn() }, skipWaiting: vi.fn(),
      addEventListener: (name: string, listener: (event: never) => void) => { listeners[name] = listener; },
    },
    caches: { open: vi.fn(async () => cache) },
    Headers, Request, Response, URL, fetch: network,
  };
  runInNewContext(worker, context);

  async function activate(value: string) {
    let promise: Promise<void> | undefined;
    const reply = vi.fn();
    listeners.message({ data: { type: "set-preview-demo-session", token: value }, ports: [{ postMessage: reply }], waitUntil: (work: Promise<void>) => { promise = work; } } as never);
    if (promise) await promise;
    return reply;
  }
  async function request(url: string, options?: RequestInit) {
    let result: Promise<Response> | undefined;
    const respondWith = vi.fn((response: Promise<Response>) => { result = response; });
    listeners.fetch({ request: new Request(url, options), respondWith } as never);
    return { respondWith, response: result ? await result : undefined };
  }
  return { activate, request, cache, network, stored, listeners };
}

describe("preview demo worker", () => {
  it("forwards only the demo session on same-origin requests and clears it on logout", async () => {
    const harness = setup();
    const reply = await harness.activate(token);
    expect(reply).toHaveBeenCalledWith({ ok: true });
    await harness.request("https://3100-abc123.e2b.app/dashboard");
    expect(harness.network.mock.calls[0][0].headers.get("x-pryva-preview-session")).toBe(token);
    await harness.request("https://3100-abc123.e2b.app/api/auth/logout", { method: "POST" });
    expect(harness.cache.delete).toHaveBeenCalledOnce();
    await harness.request("https://3100-abc123.e2b.app/dashboard");
    expect(harness.network.mock.calls[2][0].headers.get("x-pryva-preview-session")).toBeNull();
    expect(harness.cache.put).toHaveBeenCalledOnce(); // no pages or API responses are cached
  });

  it("does not attach sessions to cross-origin, static or OAuth requests", async () => {
    const harness = setup();
    await harness.activate(token);
    for (const url of ["https://other.test/", "https://3100-abc123.e2b.app/_next/static/app.js", "https://3100-abc123.e2b.app/api/auth/google"]) {
      expect((await harness.request(url)).respondWith).not.toHaveBeenCalled();
    }
    expect(harness.network).not.toHaveBeenCalled();
  });

  it("never intercepts a navigational POST, preserving its original CSRF metadata", async () => {
    const harness = setup();
    await harness.activate(token);
    const respondWith = vi.fn();
    harness.listeners.fetch({ request: { url: "https://3100-abc123.e2b.app/api/auth/demo-web", mode: "navigate", method: "POST" }, respondWith } as never);
    expect(respondWith).not.toHaveBeenCalled();
    expect(harness.network).not.toHaveBeenCalled();
  });

  it("rejects malformed tokens and never retries a failed mutation", async () => {
    const harness = setup();
    expect(await harness.activate("not-a-session")).toHaveBeenCalledWith({ ok: false });
    await harness.activate(token);
    harness.network.mockRejectedValueOnce(new Error("network failed"));
    await expect(harness.request("https://3100-abc123.e2b.app/api/orders", { method: "POST", body: "{}" })).rejects.toThrow("network failed");
    expect(harness.network).toHaveBeenCalledOnce();
  });
});
