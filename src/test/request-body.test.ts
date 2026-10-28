import { describe, expect, it, vi } from "vitest";
import { readJsonWithLimit, readTextWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

function streamRequest(chunks: Uint8Array[], cancel = vi.fn()) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); },
    cancel,
  });
  return new Request("https://pryva.test/api", {
    method: "POST", body: stream, duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("bounded streaming request bodies", () => {
  it("decodes a valid JSON body even when UTF-8 characters span chunks", async () => {
    const bytes = new TextEncoder().encode('{"name":"₦aira"}');
    const request = streamRequest([bytes.slice(0, 10), bytes.slice(10, 11), bytes.slice(11)]);
    expect(await readJsonWithLimit(request, bytes.length)).toEqual({ name: "₦aira" });
  });

  it("rejects an oversized chunked stream without Content-Length", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(9)); },
      cancel,
    });
    const request = new Request("https://pryva.test/api", { method: "POST", body: stream, duplex: "half" } as RequestInit & { duplex: "half" });
    expect(request.headers.has("content-length")).toBe(false);
    await expect(readTextWithLimit(request, 16)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("rejects a declared oversized body and malformed UTF-8", async () => {
    const request = new Request("https://pryva.test", { method: "POST", headers: { "content-length": "999" }, body: "{}" });
    await expect(readTextWithLimit(request, 16)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
    await expect(readTextWithLimit(streamRequest([new Uint8Array([0xc3, 0x28])]), 16)).rejects.toThrow();
  });

  it("preserves a UTF-8 byte order mark for signature verification", async () => {
    const value = "\uFEFF{\"event\":\"✓\"}";
    const bytes = new TextEncoder().encode(value);
    expect(await readTextWithLimit(streamRequest([bytes.slice(0, 2), bytes.slice(2)]), 100)).toBe(value);
  });
});
