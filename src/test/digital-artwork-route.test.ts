import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/digital-artwork/[key]/route";
import { CATEGORY_ART } from "@/lib/content/digital-artwork";
import { LEGACY_CATEGORY_IMAGE_IDS } from "@/lib/services/foxreload/legacy-category-images";

const params = (key: string) => ({ params: Promise.resolve({ key }) });
const request = new Request("https://example.test/digital-artwork/cod-mobile-activision");
afterEach(() => vi.unstubAllGlobals());
describe("public fixed artwork endpoint", () => {
  it("keeps legacy image IDs server-side and in sync with the fixed keys", () => {
    expect(Object.keys(LEGACY_CATEGORY_IMAGE_IDS).sort()).toEqual(Object.keys(CATEGORY_ART).sort());
    expect(Object.values(LEGACY_CATEGORY_IMAGE_IDS).every((id) => /^[a-f0-9-]{36}$/.test(id))).toBe(true);
  });
  it("rejects unknown keys without any upstream request", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await GET(request, params("__proto__"))).status).toBe(404);
    expect((await GET(request, params("https://evil.test"))).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("serves only allowed image types, with bounded caching and no redirects", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/png" } })); vi.stubGlobal("fetch", fetch);
    const result = await GET(request, params("cod-mobile-activision"));
    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toBe("image/png");
    expect(result.headers.get("x-content-type-options")).toBe("nosniff");
    expect(result.headers.get("cache-control")).toContain("s-maxage=86400");
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("70da3322-fbaa-4c11-8d39-d79061e6bde7"), expect.objectContaining({ redirect: "error", cache: "no-store" }));
    expect([...new Uint8Array(await result.arrayBuffer())]).toEqual([1, 2, 3]);
  });
  it("fails closed for HTML, oversized bodies and network failures", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("x", { headers: { "Content-Type": "text/html" } }))
      .mockResolvedValueOnce(new Response(new Uint8Array(1024 * 1024 + 1), { headers: { "Content-Type": "image/jpeg" } }))
      .mockRejectedValueOnce(new Error("private upstream details"));
    vi.stubGlobal("fetch", fetch);
    for (let i = 0; i < 3; i++) {
      const result = await GET(request, params("cod-mobile-activision"));
      expect(result.status).toBe(502);
      expect(result.headers.get("cache-control")).toBe("no-store");
      expect(await result.text()).toBe("");
    }
  });
});
