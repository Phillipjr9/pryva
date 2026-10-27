import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { BUILD_ID, staleBuildScript } from "@/lib/build-id";

/**
 * Exercises the guard the way a browser would: it runs the exact string the
 * server injects, against a stubbed document/window/fetch, and checks whether it
 * reloads. This is the part that kept breaking — the guard existed but never
 * executed — so it is tested by behaviour, not by presence.
 */
function runGuard(options: {
  pageBuild: string;
  serverBuild: string;
  reloads?: number;
  rememberedBuild?: string | null;
}) {
  const store = new Map<string, string>();
  if (options.reloads !== undefined) store.set("pryva:version-reloads", String(options.reloads));
  if (options.rememberedBuild) store.set("pryva:reloaded-for", options.rememberedBuild);

  const reload = vi.fn();
  const listeners: Record<string, () => void> = {};

  const context = {
    fetch: async () => ({ ok: true, json: async () => ({ build: options.serverBuild }) }),
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
    window: {
      location: { reload },
      addEventListener: (name: string, handler: () => void) => {
        listeners[name] = handler;
      },
    },
    document: {
      readyState: "loading",
      visibilityState: "visible",
      currentScript: null,
      querySelector: () => null,
      addEventListener: (name: string, handler: () => void) => {
        listeners[name] = handler;
      },
    },
    Number,
    String,
    JSON,
    Promise,
    setTimeout: (fn: () => void) => fn(),
  };

  runInNewContext(staleBuildScript(options.pageBuild), context);
  return { reload, listeners, store, context };
}

async function flush() {
  // The guard chains two promises (fetch → json); drain the microtask queue.
  await new Promise((resolve) => setImmediate(resolve));
}

describe("stale-build guard behaviour", () => {
  it("reloads when the tab is older than the server", async () => {
    const { reload } = runGuard({ pageBuild: "build-old", serverBuild: "build-new" });
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the tab matches the server", async () => {
    const { reload } = runGuard({ pageBuild: "build-same", serverBuild: "build-same" });
    await flush();
    expect(reload).not.toHaveBeenCalled();
  });

  it("never reloads twice for the same target build", async () => {
    const { reload } = runGuard({
      pageBuild: "build-old",
      serverBuild: "build-new",
      rememberedBuild: "build-new",
    });
    await flush();
    expect(reload).not.toHaveBeenCalled();
  });

  it("stops after two reloads even if the builds keep disagreeing", async () => {
    const { reload } = runGuard({
      pageBuild: "build-old",
      serverBuild: "build-new",
      reloads: 2,
    });
    await flush();
    expect(reload).not.toHaveBeenCalled();
  });

  it("re-checks when the tab is shown again", async () => {
    const { listeners } = runGuard({ pageBuild: "build-a", serverBuild: "build-a" });
    await flush();
    expect(typeof listeners.visibilitychange).toBe("function");
    expect(typeof listeners.pageshow).toBe("function");
  });

  it("is injected into the server HTML, never rendered as a React script tag", () => {
    // The reason for useServerInsertedHTML: React refuses to run a script element
    // it renders, and warns. This markup is streamed server-side instead.
    const source = readFileSync(
      fileURLToPath(new URL("../components/system/BuildGuard.tsx", import.meta.url)),
      "utf8",
    );
    expect(source).toContain("useServerInsertedHTML");
    expect(source).toContain("staleBuildScript(buildId)");

    const layout = readFileSync(
      fileURLToPath(new URL("../app/layout.tsx", import.meta.url)),
      "utf8",
    );
    expect(layout).toContain("BuildGuard");
    expect(layout).not.toContain("next/script");
    const code = layout.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/<script[\s>]/);
  });

  it("targets the running build", () => {
    expect(staleBuildScript(BUILD_ID)).toContain(JSON.stringify(BUILD_ID));
  });
});
