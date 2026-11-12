"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { catalogueFailureReason, fetchCatalogue, type CatalogueFailureReason } from "@/lib/platform/catalog-fetch";
import { retryAfterDeadline } from "@/lib/platform/retry-after";
import { useRetryCooldown } from "@/lib/platform/use-retry-cooldown";
import type { ExplorerFilter } from "@/lib/services/service-explorer";

type Entry = { id: string; name: string; root?: string };
const shelves: Partial<Record<ExplorerFilter, Entry[]>> = {
  esim: [{ id: "esim", name: "eSIM" }],
  subscriptions: [{ id: "subscriptions", name: "Subscriptions" }],
  games: [{ id: "games", name: "Games" }, { id: "game-currency", name: "Game currency codes" }, { id: "gaming-services", name: "Gaming services" }],
  topups: [{ id: "topups", name: "Account top-ups" }],
  "gift-cards": [{ id: "gift-cards", name: "Gift cards" }, { id: "app-stores", name: "App store credit" }, { id: "rewarble", name: "Digital vouchers" }],
  prepaid: [{ id: "prepaid-finance", name: "Prepaid and finance" }],
};

function TypeFailure({ reason, retry, retryLabel, retryBlocked }: { reason: CatalogueFailureReason; retry: () => void; retryLabel: string; retryBlocked: boolean }) {
  return <p role="alert" className="mt-2">
    {reason === "environment" ? "Product types are unavailable in this environment."
      : reason === "unconfigured" ? "Product types are not connected yet."
      : reason === "sign-in" ? <>Your session has expired. <Link href="/login?next=%2Fdashboard%2Fservices" className="underline">Sign in again</Link>.</>
      : reason === "throttled" ? "Product types were requested too quickly. Wait a little before trying again."
      : "Product types could not be loaded."}{" "}
    {retryBlocked && (reason === "error" || reason === "throttled") && "Please wait before retrying. "}
    {(reason === "error" || reason === "throttled") && <button type="button" className="underline disabled:opacity-50" disabled={retryBlocked} onClick={retry}>{retryLabel}</button>}
  </p>;
}

/** Navigate provider categories without downloading the entire enormous tree. */
export function DigitalCategoryPicker({ category, onSelect }: { category: ExplorerFilter; onSelect: (entry: Entry | null) => void }) {
  const [catalogueRoots, setCatalogueRoots] = useState<Entry[]>([]);
  const [rootError, setRootError] = useState<CatalogueFailureReason | null>(null);
  const [rootRetryAt, setRootRetryAt] = useState(0);
  const rootRetryBlocked = useRetryCooldown(rootRetryAt);
  const [rootRevision, setRootRevision] = useState(0);
  const roots = category === "all" ? catalogueRoots : shelves[category];
  const [path, setPath] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [name, setName] = useState("");
  const [cursor, setCursor] = useState("");
  const [cursors, setCursors] = useState<string[]>([]);
  const [children, setChildren] = useState<Entry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<CatalogueFailureReason | null>(null);
  const [retryAt, setRetryAt] = useState(0);
  const retryBlocked = useRetryCooldown(retryAt);
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  const parent = path.at(-1);
  useEffect(() => {
    if (category !== "all") return;
    const controller = new AbortController();
    fetchCatalogue("/api/services/digital-catalog/categories", controller.signal, { maxAttempts: 2 })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          if (!controller.signal.aborted) {
            setRootError(catalogueFailureReason(response.status, data?.code));
            setRootRetryAt(retryAfterDeadline(response.headers?.get("retry-after") ?? null, response.status === 429 ? 60_000 : 0));
          }
          return;
        }
        if (!data?.ok || !Array.isArray(data.categories)) throw new Error("Unavailable");
        if (!controller.signal.aborted) { setCatalogueRoots(data.categories); setRootError(null); setRootRetryAt(0); }
      }).catch(() => { if (!controller.signal.aborted) { setRootError("error"); setRootRetryAt(0); } });
    return () => controller.abort();
  }, [category, rootRevision]);
  useEffect(() => {
    if (!parent) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ parent: parent.id });
    if (name) params.set("name", name);
    if (cursor) params.set("cursor", cursor);
    fetchCatalogue(`/api/services/digital-catalog/subcategories?${params}`, controller.signal, { maxAttempts: 2 })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          if (!controller.signal.aborted) {
            setLoading(false); setError(catalogueFailureReason(response.status, data?.code));
            setRetryAt(retryAfterDeadline(response.headers?.get("retry-after") ?? null, response.status === 429 ? 60_000 : 0));
          }
          return;
        }
        if (!data?.ok || !Array.isArray(data.categories) || !(data.nextCursor === null || typeof data.nextCursor === "string")) throw new Error("Unavailable");
        if (!controller.signal.aborted) { setChildren(data.categories); setNext(data.nextCursor); setLoading(false); setError(null); setRetryAt(0); }
      }).catch(() => { if (!controller.signal.aborted) { setLoading(false); setError("error"); setRetryAt(0); } });
    return () => controller.abort();
  }, [parent, name, cursor, revision]);
  if (!roots) return null;
  function navigate(nextPath: Entry[]) {
    setPath(nextPath); onSelect(nextPath.length ? { ...nextPath[nextPath.length - 1], root: nextPath[0].id } : null); setInput(""); setName(""); setCursor(""); setCursors([]); setChildren([]); setNext(null); setError(null); setRetryAt(0); setLoading(nextPath.length > 0);
  }
  return <div role="group" aria-label="Browse product types" className="mt-4 rounded-xl border border-line bg-white p-3 text-meta text-ink-2">
    <p className="font-semibold text-ink">Browse product types</p>
    <div className="mt-2 flex flex-wrap gap-2">
      {path.length > 0 && <button type="button" onClick={() => navigate(path.slice(0, -1))} className="rounded-lg border border-line px-3 py-2">Back</button>}
      {path.length > 0 && <button type="button" onClick={() => navigate([])} className="rounded-lg border border-line px-3 py-2">All {category}</button>}
      <span className="self-center">{path.map((entry) => entry.name).join(" / ") || "Choose a product family"}</span>
    </div>
    {!parent ? <>
      {rootError && <TypeFailure reason={rootError} retryBlocked={rootRetryBlocked} retry={() => { setRootError(null); setRootRetryAt(0); setRootRevision((value) => value + 1); }} retryLabel="Retry types" />}
      <div className="mt-2 flex flex-wrap gap-2">{roots.map((root) => <button key={root.id} type="button" onClick={() => navigate([root])} className="rounded-lg border border-line px-3 py-2">{root.name}</button>)}</div>
    </> : <>
      <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); setName(input.trim().slice(0, 128)); setCursor(""); setCursors([]); setLoading(true); setRevision((n) => n + 1); }}>
        <label className="sr-only" htmlFor="product-category-search">Find a product type</label>
        <input id="product-category-search" value={input} onChange={(event) => setInput(event.target.value)} maxLength={128} placeholder="Find a product type" className="min-h-10 min-w-0 flex-1 rounded-lg border border-line px-3" />
        <button className="rounded-lg border border-line px-3 py-2">Find</button>
      </form>
      {loading ? <p className="mt-2" role="status">Loading product types…</p> : error ? <TypeFailure reason={error} retryBlocked={retryBlocked} retry={() => { setLoading(true); setRetryAt(0); setRevision((n) => n + 1); }} retryLabel="Retry" /> : <>
        <div className="mt-2 flex flex-wrap gap-2">{children.map((child) => <button key={child.id} type="button" onClick={() => navigate([...path, child])} className="rounded-lg border border-line px-3 py-2">{child.name}</button>)}</div>
        {!children.length && <p className="mt-2">No further product types. Listings for this selection are shown below.</p>}
        <div className="mt-2 flex gap-2">
          {cursors.length > 0 && <button type="button" onClick={() => { setLoading(true); setCursor(cursors.at(-1) ?? ""); setCursors(cursors.slice(0, -1)); }} className="rounded-lg border border-line px-3 py-2">Previous types</button>}
          {next && next !== cursor && !cursors.includes(next) && <button type="button" onClick={() => { setLoading(true); setCursors([...cursors, cursor]); setCursor(next); }} className="rounded-lg border border-line px-3 py-2">More types</button>}
        </div>
      </>}
    </>}
  </div>;
}
