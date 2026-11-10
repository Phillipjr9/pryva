"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

type Result = { items: { id: string; name: string; stock: "reported" | "out" | "unknown"; checkout?: "codes" | "topups" | "esims" }[]; nextCursor: string | null; searchLimited: boolean; skipped: boolean };

export function DigitalCatalogBrowser() {
  const [input, setInput] = useState("");
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [category, setCategory] = useState("");
  const [stockOnly, setStockOnly] = useState(true);
  const [categoryError, setCategoryError] = useState(false);
  const [query, setQuery] = useState("");
  const [cursors, setCursors] = useState<string[]>([""]);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const request = useRef(0);
  const cursor = cursors[page] ?? "";
  // A cursor already visited on a later page is valid when navigating forward
  // again; only an earlier/current cursor indicates a loop.
  const cursorLoops = !!result?.nextCursor && cursors.slice(0, page + 1).includes(result.nextCursor);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/services/digital-catalog/categories", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !Array.isArray(data?.categories)) throw new Error("Unavailable");
        if (!controller.signal.aborted) setCategories(data.categories);
      }).catch(() => { if (!controller.signal.aborted) setCategoryError(true); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const token = ++request.current;
    const params = new URLSearchParams();
    // Category search upstream is exact-category only; search the whole catalogue
    // instead of silently omitting descendant products.
    if (category && !query) params.set("category", category);
    if (stockOnly) params.set("stock", "available");
    if (query) params.set("q", query);
    else if (cursor) params.set("cursor", cursor);
    fetch(`/api/services/digital-catalog?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (controller.signal.aborted || token !== request.current) return;
        if (!response.ok || !data?.ok || !Array.isArray(data.items)) {
          setResult(null); setError(typeof data?.error === "string" ? data.error : "Could not load the catalogue.");
        } else { setResult(data as Result); setError(null); }
        setLoading(false);
      }).catch(() => {
        if (controller.signal.aborted || token !== request.current) return;
        setResult(null); setError("Could not load the catalogue. Try again later."); setLoading(false);
      });
    return () => controller.abort();
  }, [query, cursor, category, stockOnly, revision]);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = input.trim();
    if (next.length > 0 && next.length < 2) { setError("Enter at least two characters."); return; }
    setResult(null); setError(null); setLoading(true); setCursors([""]); setPage(0);
    if (next === query && !cursor) setRevision((value) => value + 1);
    else setQuery(next);
  }

  return (
    <section aria-label="Digital catalogue" className="rounded-2xl border border-line bg-white p-4 sm:p-6">
      <label htmlFor="digital-category" className="block text-meta font-semibold text-ink">Browse by category</label>
      <select id="digital-category" value={category} onChange={(event) => {
        if (event.target.value === category && !query && !cursor) setRevision((value) => value + 1);
        setCategory(event.target.value); setInput(""); setQuery(""); setCursors([""]); setPage(0); setResult(null); setError(null); setLoading(true);
      }} className="mt-2 mb-4 min-h-11 w-full rounded-xl border border-line px-3 py-2">
        <option value="">All categories</option>
        {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select>
      {categoryError && <p className="mb-3 text-meta text-ink-2">Categories could not be loaded; you can still browse or search all products.</p>}
      <form onSubmit={search} className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="digital-search">Search digital products</label>
        <input id="digital-search" type="search" value={input} maxLength={128} onChange={(event) => setInput(event.target.value)} placeholder="Search games, subscriptions or telecom" className="min-h-11 min-w-0 flex-1 rounded-xl border border-line px-3 py-2" />
        <button className="min-h-11 rounded-xl bg-lav-700 px-4 font-semibold text-white" type="submit">Search</button>
      </form>
      <label className="mt-4 flex items-center gap-2 text-meta font-semibold text-ink"><input type="checkbox" checked={stockOnly} onChange={(event) => { setStockOnly(event.target.checked); setCursors([""]); setPage(0); setResult(null); setError(null); setLoading(true); }} /> Show listings with reported stock only</label>
      <p className="mt-3 text-meta text-ink-3">Stock is reported by the catalogue and may change. It does not guarantee checkout. Browse every page within a category; search covers all categories and returns up to 50 matches, so refine your search or clear it to browse more.</p>
      {loading ? <p role="status" className="mt-4 text-meta text-ink-2">Loading catalogue…</p> : null}
      {error ? <p role="alert" className="mt-4 text-meta text-rose-700">{error} <button type="button" className="font-semibold underline" onClick={() => { setLoading(true); setError(null); setRevision((value) => value + 1); }}>Retry</button></p> : null}
      {result && !loading ? (
        <>
          <p className="mt-4 text-meta text-ink-3">{result.items.length} listings on this page{result.searchLimited ? " · more matches may exist; refine your search" : ""}{result.skipped ? " · some listings could not be read" : ""}</p>
          {result.items.length ? <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{result.items.map((item) => <li key={item.id} className="rounded-xl border border-line p-3"><p className="font-semibold text-ink">{item.name}</p><p className="mt-1 text-meta text-ink-3">{item.stock === "reported" ? "Stock reported" : item.stock === "out" ? "Out of stock (reported)" : "Stock unknown"}</p>{item.checkout ? <Link href={`/dashboard/digital-${item.checkout}?product=${encodeURIComponent(item.id)}`} className="mt-1 inline-block text-meta font-semibold text-lav-700 underline">Check price and availability</Link> : <p className="mt-1 text-meta text-ink-3">Not available to order</p>}</li>)}</ul> : <p className="mt-3 text-meta text-ink-2">No listings returned. This does not confirm availability.</p>}
          {!query && result.nextCursor && cursorLoops && <p role="alert" className="mt-3 text-meta text-rose-700">The catalogue pagination did not advance. Please try again later.</p>}
          {!query && <div className="mt-4 flex gap-3"><button type="button" disabled={page === 0} onClick={() => { setLoading(true); setPage(page - 1); }} className="rounded-lg border border-line px-3 py-2 text-meta disabled:opacity-40">Previous</button><button type="button" disabled={!result.nextCursor || cursorLoops} onClick={() => { if (!result.nextCursor) return; setLoading(true); setCursors([...cursors.slice(0, page + 1), result.nextCursor]); setPage(page + 1); }} className="rounded-lg border border-line px-3 py-2 text-meta disabled:opacity-40">Next page</button></div>}
        </>
      ) : null}
    </section>
  );
}
