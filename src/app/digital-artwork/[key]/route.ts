import { CATEGORY_ART } from "@/lib/content/digital-artwork";

// Only fixed, reviewed image identifiers can be fetched. Never proxy a URL
// supplied by a visitor or a catalogue listing.
export async function GET(_request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!Object.hasOwn(CATEGORY_ART, key)) return new Response(null, { status: 404 });
  const id = CATEGORY_ART[key as keyof typeof CATEGORY_ART];
  try {
    const upstream = await fetch(`https://cdn.marix.cc/catalog/category/${id}`, {
      redirect: "error", signal: AbortSignal.timeout(5000), cache: "no-store",
    });
    const type = upstream.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if (!upstream.ok || !type || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(type) || !upstream.body) throw new Error("Unavailable");
    const max = 1024 * 1024;
    const declared = Number(upstream.headers.get("content-length"));
    if (declared > max) throw new Error("Too large");
    const reader = upstream.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw new Error("Too large"); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new Response(bytes, { headers: { "Content-Type": type, "X-Content-Type-Options": "nosniff", "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400" } });
  } catch {
    return new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
