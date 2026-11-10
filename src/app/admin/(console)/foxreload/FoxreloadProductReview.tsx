"use client";
import { useState, type FormEvent } from "react";

type Item = { id: string; name: string };
type Product = { id: string; name: string; deliveryType: string | null; currency: string | null; unitPrice: string | null; quantity: number | null; countryCode?: string | null; marketRegion?: string | null; minQuantity: number | null; maxQuantity: number | null; requiredNoteFields: string[] | null; noteFieldTypes: Record<string, string> | null; noteFieldOptions: Record<string, { value: string; label: string }[]> | null };
export function FoxreloadProductReview() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [product, setProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function fetchResult(params: URLSearchParams) {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/admin/foxreload/products?${params}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error("unavailable");
      return data;
    } catch { setError("Could not read products. Check the search and try again."); return null; }
    finally { setBusy(false); }
  }
  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setProduct(null); setItems(null);
    const value = query.trim();
    if (value.length < 2) { setError("Enter at least two characters."); return; }
    const data = await fetchResult(new URLSearchParams({ q: value }));
    if (data && Array.isArray(data.items)) { setItems(data.items); setTruncated(data.searchLimited === true); }
  }
  async function inspect(id: string) {
    setProduct(null);
    const data = await fetchResult(new URLSearchParams({ id }));
    if (data?.product) setProduct(data.product);
  }
  return <section className="rounded-2xl border border-line bg-white p-5">
    <h2 className="text-lg font-semibold text-ink">Review account products</h2>
    <p className="mt-2 text-meta text-ink-2">Read-only search and product details. This does not approve or purchase a product. Verify redemption terms and delivery with the account before enabling it.</p>
    <form onSubmit={search} className="mt-4 flex gap-2"><label htmlFor="fox-product-search" className="sr-only">Search account products</label><input id="fox-product-search" value={query} maxLength={80} onChange={(event) => setQuery(event.target.value)} placeholder="Search product name" className="min-h-11 min-w-0 flex-1 rounded-xl border border-line px-3" /><button disabled={busy} className="rounded-xl bg-lav-700 px-4 font-semibold text-white disabled:opacity-50">Search</button></form>
    {error && <p role="alert" className="mt-3 text-meta text-rose-700">{error}</p>}
    {items && <div className="mt-4"><p className="text-meta text-ink-2">{items.length} results{truncated ? "; more may exist, refine the search" : ""}.</p><ul className="mt-2 grid gap-2">{items.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3"><span>{item.name}</span><button type="button" disabled={busy} onClick={() => inspect(item.id)} className="text-meta font-semibold text-lav-700 underline disabled:opacity-50">Inspect</button></li>)}</ul></div>}
    {product && <div className="mt-4 rounded-xl bg-cream p-4 text-sm text-ink-2"><h3 className="font-semibold text-ink">{product.name}</h3><p className="mt-1 break-all">Product ID: {product.id}</p><p>Delivery: {product.deliveryType ?? "unknown"}; currency: {product.currency ?? "unknown"}; unit price: {product.unitPrice ?? "unknown"}</p><p>Account quantity: {product.quantity ?? "unknown"}; order minimum: {product.minQuantity ?? "unknown"}; maximum: {product.maxQuantity ?? "not specified"}</p><p>Country: {product.countryCode === undefined ? "unknown" : product.countryCode ?? "not specified"}; region: {product.marketRegion === undefined ? "unknown" : product.marketRegion ?? "not specified"}</p><p>Required field metadata: {product.requiredNoteFields === null ? "unknown" : product.requiredNoteFields.length ? product.requiredNoteFields.map((field) => `${field} (${product.noteFieldTypes?.[field] ?? "type unknown"})`).join(", ") : "none"}</p><p className="mt-2">Do not enter passwords or confirmation codes here. Price and stock may change; this inspection is not approval to sell.</p></div>}
  </section>;
}
