"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

type Result = { items: { id: string; name: string }[]; nextCursor: string | null; searchLimited: boolean; skipped: boolean };

export function DigitalCatalogBrowser() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [cursors, setCursors] = useState<string[]>([""]);
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const request = useRef(0);
  const cursor = cursors[page] ?? "";

  useEffect(() => {
    const controller = new AbortController();
    const token = ++request.current;
    const params = new URLSearchParams();
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
  }, [query, cursor, revision]);

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
      <form onSubmit={search} className="flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="digital-search">Search digital products</label>
        <input id="digital-search" type="search" value={input} maxLength={128} onChange={(event) => setInput(event.target.value)} placeholder="Search games, subscriptions or telecom" className="min-h-11 min-w-0 flex-1 rounded-xl border border-line px-3 py-2" />
        <button className="min-h-11 rounded-xl bg-lav-700 px-4 font-semibold text-white" type="submit">Search</button>
      </form>
      <p className="mt-3 text-meta text-ink-3">Search returns up to 50 matches. Clear search to browse all pages.</p>
      {loading ? <p role="status" className="mt-4 text-meta text-ink-2">Loading catalogue…</p> : null}
      {error ? <p role="alert" className="mt-4 text-meta text-rose-700">{error} <button type="button" className="font-semibold underline" onClick={() => { setLoading(true); setError(null); setRevision((value) => value + 1); }}>Retry</button></p> : null}
      {result && !loading ? (
        <>
          <p className="mt-4 text-meta text-ink-3">{result.items.length} listings on this page{result.searchLimited ? " · more matches may exist; refine your search" : ""}{result.skipped ? " · some listings could not be read" : ""}</p>
          {result.items.length ? <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{result.items.map((item) => <li key={item.id} className="rounded-xl border border-line p-3"><p className="font-semibold text-ink">{item.name}</p><p className="mt-1 text-meta text-ink-3">Not available to order</p></li>)}</ul> : <p className="mt-3 text-meta text-ink-2">No listings returned. This does not confirm availability.</p>}
          {!query && result.nextCursor && cursors.includes(result.nextCursor) && <p role="alert" className="mt-3 text-meta text-rose-700">The catalogue pagination did not advance. Please try again later.</p>}
          {!query && <div className="mt-4 flex gap-3"><button type="button" disabled={page === 0} onClick={() => { setLoading(true); setPage(page - 1); }} className="rounded-lg border border-line px-3 py-2 text-meta disabled:opacity-40">Previous</button><button type="button" disabled={!result.nextCursor || cursors.includes(result.nextCursor)} onClick={() => { if (!result.nextCursor) return; setLoading(true); setCursors([...cursors.slice(0, page + 1), result.nextCursor]); setPage(page + 1); }} className="rounded-lg border border-line px-3 py-2 text-meta disabled:opacity-40">Next page</button></div>}
        </>
      ) : null}
    </section>
  );
}
