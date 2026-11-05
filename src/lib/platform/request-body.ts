/** Read request bodies with a hard streaming byte limit, including chunked requests. */
export class RequestBodyTooLargeError extends Error {}

export async function readTextWithLimit(request: Request | Response, maxBytes: number): Promise<string> {
  const length = request.headers.get("content-length");
  if (length && /^\d+$/.test(length) && Number(length) > maxBytes) throw new RequestBodyTooLargeError();
  if (!request.body) throw new SyntaxError("Missing request body");

  const reader = request.body.getReader();
  // Keep a UTF-8 BOM in the decoded text so signatures cover the exact bytes.
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  let body = "";
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new RequestBodyTooLargeError();
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return body;
  } finally {
    reader.releaseLock();
  }
}

export async function readJsonWithLimit(request: Request | Response, maxBytes: number): Promise<unknown> {
  return JSON.parse(await readTextWithLimit(request, maxBytes)) as unknown;
}

export function isJsonRequest(request: Request): boolean {
  return /^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "");
}
