import { readFileSync, existsSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import manifest from "@/app/manifest";

/**
 * The service worker is the one piece of the app that keeps running after the
 * tab closes, on a device it may share with someone else. So rather than assert
 * that some lines exist, these tests execute `public/sw.js` in a small Worker
 * sandbox with a fake Cache API and check what it actually does with requests:
 * what it caches, what it refuses to touch, and what it serves when the network
 * is gone.
 */

type CacheEntry = Map<string, Response>;

function createWorker() {
  const stores = new Map<string, CacheEntry>();
  const fetchCalls: string[] = [];
  const listeners = new Map<string, (event: unknown) => void>();
  const network = new Map<string, () => Promise<Response>>();
  // The real server answers these; the fake one must too, or install fails.
  network.set("/offline", async () => new Response("<html>The connection dropped.</html>", { status: 200 }));
  network.set("/icons/icon-192.png", async () => new Response("png", { status: 200 }));
  network.set("/icons/icon-512.png", async () => new Response("png", { status: 200 }));

  // The Cache API resolves a string against the worker's origin; the fake one
  // must too, or `cache.match("/offline")` misses an entry stored as a full URL.
  const keyFor = (request: Request | string) =>
    new URL(typeof request === "string" ? request : request.url, "https://pryva.ng").toString();

  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      async match(request: Request | string) {
        const hit = store.get(keyFor(request));
        return hit ? hit.clone() : undefined;
      },
      async put(request: Request | string, response: Response) {
        store.set(keyFor(request), response.clone());
      },
      async addAll(urls: string[]) {
        for (const url of urls) {
          const response = await fetchImpl(new Request(new URL(url, "https://pryva.ng").toString()));
          store.set(new URL(url, "https://pryva.ng").toString(), response.clone());
        }
      },
      async keys() {
        return [...store.keys()].map((key) => new Request(key));
      },
      async delete(request: Request | string) {
        return store.delete(keyFor(request));
      },
    };
  };

  const fetchImpl = async (request: Request): Promise<Response> => {
    fetchCalls.push(request.url);
    const handler = network.get(new URL(request.url).pathname);
    if (!handler) throw new TypeError("Failed to fetch");
    return handler();
  };

  const sandbox = {
    self: {
      location: { origin: "https://pryva.ng" },
      addEventListener: (name: string, handler: (event: unknown) => void) => listeners.set(name, handler),
      skipWaiting: async () => {},
      clients: { claim: async () => {} },
    },
    caches: {
      open,
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
    },
    fetch: fetchImpl,
    Request,
    Response,
    URL,
    Promise,
    console,
  };

  runInNewContext(readFileSync("public/sw.js", "utf8"), sandbox);

  async function fireInstall() {
    const waits: Array<Promise<unknown>> = [];
    listeners.get("install")!({ waitUntil: (promise: Promise<unknown>) => waits.push(promise) });
    await Promise.all(waits);
  }

  async function fireActivate() {
    const waits: Array<Promise<unknown>> = [];
    listeners.get("activate")!({ waitUntil: (promise: Promise<unknown>) => waits.push(promise) });
    await Promise.all(waits);
  }

  function dispatch(request: Request) {
    let response: Promise<Response> | undefined;
    listeners.get("fetch")!({
      request,
      respondWith: (next: Promise<Response>) => {
        response = next;
      },
    });
    return response;
  }

  return { stores, fetchCalls, network, fireInstall, fireActivate, dispatch };
}

const get = (path: string) => new Request(`https://pryva.ng${path}`);
const navigate = (path: string) => {
  const request = get(path);
  Object.defineProperty(request, "mode", { value: "navigate" });
  return request;
};

describe("app manifest", () => {
  const value = manifest();

  it("describes an installable, standalone app that starts at the dashboard entry", () => {
    expect(value.name).toBe("Pryva");
    expect(value.short_name).toBe("Pryva");
    expect(value.start_url).toBe("/");
    expect(value.scope).toBe("/");
    expect(value.display).toBe("standalone");
    expect(value.background_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(value.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("ships icons that exist and match their declared size", () => {
    const icons = value.icons ?? [];
    expect(icons.length).toBeGreaterThanOrEqual(3);
    expect(icons.some((icon) => icon.purpose === "maskable")).toBe(true);

    for (const icon of icons) {
      const path = `public${icon.src}`;
      expect(existsSync(path), `${icon.src} is missing from public/`).toBe(true);

      // A PNG's width and height are the two big-endian uint32s in the IHDR
      // chunk, which always starts at byte 16.
      const header = readFileSync(path).subarray(0, 24);
      const width = header.readUInt32BE(16);
      const height = header.readUInt32BE(20);
      expect(`${width}x${height}`, `${icon.src} size`).toBe(icon.sizes);
    }
  });
});

describe("service worker", () => {
  it("precaches only the offline page and the icons", async () => {
    const worker = createWorker();
    await worker.fireInstall();

    const store = worker.stores.get("pryva-v1-static")!;
    expect([...store.keys()]).toEqual([
      "https://pryva.ng/offline",
      "https://pryva.ng/icons/icon-192.png",
      "https://pryva.ng/icons/icon-512.png",
    ]);
  });

  it("ignores non-GET requests, the API and other origins entirely", async () => {
    const worker = createWorker();
    await worker.fireInstall();

    const post = new Request("https://pryva.ng/api/auth/login", { method: "POST" });
    expect(worker.dispatch(post)).toBeUndefined();
    expect(worker.dispatch(get("/api/wallet"))).toBeUndefined();
    expect(worker.dispatch(new Request("https://elsewhere.test/app.js"))).toBeUndefined();

    expect(worker.fetchCalls).toHaveLength(3); // the precache only
  });

  it("does not intercept a non-GET request even for a cacheable path", async () => {
    const worker = createWorker();
    await worker.fireInstall();

    const post = new Request("https://pryva.ng/_next/static/app.js", { method: "POST" });
    expect(worker.dispatch(post)).toBeUndefined();
  });

  it("never stores an HTML navigation, and falls back to /offline when the network fails", async () => {
    const worker = createWorker();
    await worker.fireInstall();
    worker.network.set("/dashboard", async () => new Response("<html>wallet</html>", { status: 200 }));

    const live = await worker.dispatch(navigate("/dashboard"));
    expect(await live!.text()).toContain("wallet");

    const store = worker.stores.get("pryva-v1-static")!;
    expect(store.has("https://pryva.ng/dashboard")).toBe(false);

    worker.network.delete("/dashboard");
    const offline = await worker.dispatch(navigate("/dashboard"));
    expect(await offline!.text()).toContain("The connection dropped.");
  });

  it("serves hashed build assets from cache without hitting the network twice", async () => {
    const worker = createWorker();
    await worker.fireInstall();
    worker.network.set("/_next/static/app.js", async () => new Response("console.log(1)", { status: 200 }));

    const first = await worker.dispatch(get("/_next/static/app.js"));
    expect(await first!.text()).toBe("console.log(1)");
    const afterFirst = worker.fetchCalls.length;

    const second = await worker.dispatch(get("/_next/static/app.js"));
    expect(await second!.text()).toBe("console.log(1)");
    expect(worker.fetchCalls.length).toBe(afterFirst);
  });

  it("does not cache an error response for an asset", async () => {
    const worker = createWorker();
    await worker.fireInstall();
    worker.network.set("/_next/static/broken.js", async () => new Response("nope", { status: 500 }));

    const response = await worker.dispatch(get("/_next/static/broken.js"));
    expect(response!.status).toBe(500);

    const store = worker.stores.get("pryva-v1-static")!;
    expect(store.has("https://pryva.ng/_next/static/broken.js")).toBe(false);
  });

  it("deletes caches from an older version on activate", async () => {
    const worker = createWorker();
    await worker.fireInstall();
    worker.stores.set("pryva-v0-static", new Map([["https://pryva.ng/old", new Response("old")]]));

    await worker.fireActivate();

    expect([...worker.stores.keys()]).toEqual(["pryva-v1-static"]);
  });
});

describe("registration", () => {
  it("registers only in production, and never before the first paint", () => {
    const source = readFileSync("src/components/system/ServiceWorkerRegistration.tsx", "utf8");
    expect(source).toContain('process.env.NODE_ENV !== "production"');
    expect(source).toContain('register("/sw.js")');
    expect(source).toContain("setTimeout");
    expect(source).not.toMatch(/register\("\/sw\.js"\)(?!\.catch)/);
  });

  it("is mounted by the root layout", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8");
    expect(layout).toContain("<ServiceWorkerRegistration />");
  });
});
