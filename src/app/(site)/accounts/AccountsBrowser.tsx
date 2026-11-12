"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { fetchCatalogue, SHARED_CATALOGUE_TIMEOUT_MS } from "@/lib/platform/catalog-fetch";
import { formatNaira } from "@/lib/services/catalog";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/platform/utils";
import { PlatformBadge, platformFor } from "@/components/PlatformBadge";
import { QuickShortcuts } from "@/components/QuickShortcuts";
import { UnitsStatus } from "@/components/dashboard/UnitsStatus";
import { warrantyBadge, warrantyLabel } from "@/lib/services/warranty";
import { readAccountCategories, readAccountListings, type AccountCategory, type AccountListing, type AccountMeta } from "@/lib/services/accounts/catalogue-display";
import { accountPlatformShortcuts, type AccountShortcut } from "@/lib/services/accounts/platform-shortcuts";

const SORTS = [
  { value: "total_price", label: "Price: lowest first" },
  { value: "sort_key", label: "Recommended" },
  { value: "available_stock", label: "Most stock" },
  { value: "title", label: "A–Z" },
] as const;

export function AccountsBrowser({ purchaseEnabled }: { purchaseEnabled: boolean }) {
  const [categories, setCategories] = useState<AccountCategory[]>([]);
  const [subcategories, setSubcategories] = useState<AccountCategory[]>([]);
  const [configured, setConfigured] = useState(true);
  const [activeCategory, setActiveCategory] = useState<number | null>(null);
  const [activeSubcategory, setActiveSubcategory] = useState<number | null>(null);
  const [showAllSubcategories, setShowAllSubcategories] = useState(false);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [shortcutSelection, setShortcutSelection] = useState<AccountShortcut | null>(null);
  const [sort, setSort] = useState<(typeof SORTS)[number]["value"]>("total_price");
  const [page, setPage] = useState(1);
  const [inStockOnly, setInStockOnly] = useState(true);

  const [listings, setListings] = useState<AccountListing[]>([]);
  const [meta, setMeta] = useState<AccountMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorQuery, setErrorQuery] = useState<string | null>(null);
  const [showingPrevious, setShowingPrevious] = useState(false);
  const [partial, setPartial] = useState(false);
  const [stale, setStale] = useState(false);
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const [selected, setSelected] = useState<AccountListing | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [buying, setBuying] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [result, setResult] = useState<{ accounts: string[]; reference: string; totalNgn: number; warning?: string } | null>(null);
  const [preparing, setPreparing] = useState<{ reference?: string; message: string } | null>(null);
  const [pending, setPending] = useState<{ reference?: string; message: string } | null>(null);
  const purchaseRequestId = useRef<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [promoInput, setPromoInput] = useState("");
  const [promo, setPromo] = useState<{ code: string; totalNgn: number; savedNgn: number; message: string } | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoMessage, setPromoMessage] = useState<string | null>(null);

  const [needsSignIn, setNeedsSignIn] = useState(false);
  const requestId = useRef(0);
  const listingsRequest = useRef<AbortController | null>(null);
  const lastSuccessfulQuery = useRef<string | null>(null);
  const queryKey = useMemo(() => {
    const params = new URLSearchParams({ sort, page: String(page) });
    if (inStockOnly) params.set("inStock", "true");
    if (activeCategory) params.set("categoryId", String(activeCategory));
    if (activeSubcategory) params.set("subcategoryId", String(activeSubcategory));
    if (search) params.set("search", search);
    return params.toString();
  }, [sort, page, inStockOnly, activeCategory, activeSubcategory, search]);
  // Hide and lock the previous query as soon as the shopper edits the search,
  // not only after its debounce has started the next request.
  const searchPending = searchInput.trim() !== search;
  const matchesQuery = !searchPending && loadedQuery === queryKey;
  const visibleListings = matchesQuery ? listings : [];
  const currentError = !searchPending && errorQuery === queryKey ? error : null;
  const isLoading = searchPending || loading || (!matchesQuery && !currentError);
  const accountChoices = useMemo(() => {
    const choices = accountPlatformShortcuts(matchesQuery ? listings : []);
    // Keep the active filter visible even if a refresh returns no matches.
    if (shortcutSelection && !choices.some((choice) => choice.key === shortcutSelection.key)) choices.unshift(shortcutSelection);
    return choices;
  }, [listings, matchesQuery, shortcutSelection]);

  // Debounce the search box so we don't hammer the provider.
  useEffect(() => {
    const next = searchInput.trim();
    if (next === search) return;
    const timer = setTimeout(() => {
      setSearch(next);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput, search]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const url = activeCategory ? `/api/accounts/categories?categoryId=${activeCategory}` : "/api/accounts/categories";

    fetchCatalogue(url, controller.signal, { timeoutMs: SHARED_CATALOGUE_TIMEOUT_MS })
      .then((response) => {
        if (!response.ok) throw new Error("Categories unavailable");
        return response.json();
      })
      .then((data: unknown) => {
        if (cancelled) return;
        if (data && typeof data === "object" && "configured" in data && data.configured === false) {
          setConfigured(false);
          return;
        }
        const parsed = readAccountCategories(data);
        if (!parsed) throw new Error("Invalid categories");
        setConfigured(true);
        setCategoryError(parsed.incomplete ? "Some categories could not be shown. Refresh the page to retry." : null);
        setCategories(parsed.categories);
        // The root response may contain hundreds of product lines. They are
        // not a useful filter until a category is selected and can push all
        // actual listings far below the fold.
        setSubcategories(activeCategory ? parsed.subcategories : []);
      })
      .catch(() => {
        if (!cancelled) setCategoryError("Could not load all categories. Refresh the page to retry.");
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeCategory]);

  const loadListings = useCallback(async () => {
    listingsRequest.current?.abort();
    const controller = new AbortController();
    listingsRequest.current = controller;
    const current = ++requestId.current;
    setLoading(true);
    setError(null);

    function fail(message: string) {
      const keepPrevious = lastSuccessfulQuery.current === queryKey;
      setError(message);
      setErrorQuery(queryKey);
      setShowingPrevious(keepPrevious);
      if (!keepPrevious) {
        // A result for different filters must not look like a match here.
        lastSuccessfulQuery.current = null;
        setLoadedQuery(null);
        setListings([]);
        setMeta(null);
        setLastChecked(null);
        setPartial(false);
        setStale(false);
      }
    }

    try {
      const response = await fetchCatalogue(`/api/accounts/listings?${queryKey}`, controller.signal, { timeoutMs: SHARED_CATALOGUE_TIMEOUT_MS });
      const data: unknown = await response.json().catch(() => null);
      if (current !== requestId.current) return;
      const body = data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null;
      if (!response.ok) {
        fail(typeof body?.error === "string" && body.error.length <= 300 ? body.error : "Could not load accounts.");
        return;
      }
      if (body?.configured === false) {
        setConfigured(false);
        lastSuccessfulQuery.current = null;
        setLoadedQuery(null);
        setListings([]); setMeta(null); setLastChecked(null);
        setPartial(false); setStale(false); setShowingPrevious(false);
        return;
      }
      const parsed = readAccountListings(data);
      if (!parsed || (Array.isArray(body?.listings) && body.listings.length > 0 && parsed.listings.length === 0)) {
        fail("The account catalogue could not be read. Please try again.");
        return;
      }
      setConfigured(true);
      lastSuccessfulQuery.current = queryKey;
      setLoadedQuery(queryKey);
      setShowingPrevious(false);
      setPartial(parsed.incomplete);
      setStale(body?.stale === true);
      setListings(parsed.listings);
      setMeta(parsed.meta);
      const checkedAt = body?.checkedAt;
      setLastChecked(typeof checkedAt === "string" && Number.isFinite(Date.parse(checkedAt))
        ? new Date(checkedAt).toLocaleString() : null);
    } catch {
      if (!controller.signal.aborted && current === requestId.current) fail("Could not load accounts. Check your connection.");
    } finally {
      if (listingsRequest.current === controller) listingsRequest.current = null;
      if (current === requestId.current) setLoading(false);
    }
  }, [queryKey]);

  useEffect(() => {
    const version = requestId;
    const request = listingsRequest;
    const timer = setTimeout(() => void loadListings(), 0);
    return () => {
      clearTimeout(timer);
      version.current++;
      request.current?.abort();
      request.current = null;
    };
  }, [loadListings]);

  function selectCategory(id: number | null) {
    setActiveCategory(id);
    setActiveSubcategory(null);
    setShowAllSubcategories(false);
    setPage(1);
  }

  function selectSubcategory(id: number | null) {
    setActiveSubcategory(id);
    setPage(1);
  }

  function clearFilters() {
    selectCategory(null);
    setShortcutSelection(null);
    setSearchInput("");
    setSearch("");
    setPage(1);
  }

  /**
   * Orderable right now? A hand-prepared item has no published stock count, so
   * availability — not a number — decides whether it can be bought. Inventing a
   * count for it would tell the customer something nobody knows.
   */
  function canBuy(listing: AccountListing): boolean {
    // The server flag includes the item's own fulfilment gate. Also honour the
    // page-wide gate and require the exact current row, not an old modal copy.
    if (!purchaseEnabled || !listing.purchasable || isLoading || currentError || !listing.available || !visibleListings.includes(listing)) return false;
    return listing.stock === null ? listing.fulfilment === "manual" : listing.stock >= listing.minQuantity;
  }

  function openBuy(listing: AccountListing) {
    if (!canBuy(listing)) return;
    purchaseRequestId.current = null;
    setPending(null);
    setPreparing(null);
    setSelected(listing);
    setQuantity(Math.max(1, listing.minQuantity));
    setBuyError(null);
    setResult(null);
    setNeedsSignIn(false);
    setPromo(null);
    setPromoInput("");
    setPromoMessage(null);
  }

  const estimatedTotal = useMemo(() => {
    if (!selected) return 0;
    if (promo) return promo.totalNgn;
    const discountPercent = quantity >= 25 ? 10 : quantity >= 10 ? 8 : quantity >= 5 ? 5 : 0;
    return Math.ceil((selected.priceNgn * quantity * (1 - discountPercent / 100)) / 50) * 50;
  }, [selected, quantity, promo]);

  async function applyPromo() {
    if (!selected) return;
    const code = promoInput.trim();
    if (!code) {
      setPromoMessage("Enter a promo code.");
      return;
    }
    setPromoBusy(true);
    setPromoMessage(null);
    try {
      const response = await fetch("/api/accounts/promo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, slug: selected.slug, quantity }),
      });
      const data = (await response.json()) as {
        valid?: boolean;
        code?: string;
        totalNgn?: number;
        savedNgn?: number;
        message?: string;
        error?: string;
      };
      if (data.valid && typeof data.totalNgn === "number") {
        setPromo({
          code: data.code ?? code,
          totalNgn: data.totalNgn,
          savedNgn: data.savedNgn ?? 0,
          message: data.message ?? "Promo applied.",
        });
        setPromoMessage(null);
      } else {
        setPromo(null);
        setPromoMessage(data.message ?? data.error ?? "That code isn't valid for this order.");
      }
    } catch {
      setPromo(null);
      setPromoMessage("We couldn't check that code. Please try again.");
    } finally {
      setPromoBusy(false);
    }
  }

  async function buy() {
    if (!selected || !canBuy(selected)) return;
    setBuying(true);
    setBuyError(null);

    try {
      purchaseRequestId.current ??= crypto.randomUUID();
      const response = await fetch("/api/accounts/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: selected.slug, quantity, promoCode: promo?.code, requestId: purchaseRequestId.current }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        accounts?: string[];
        totalNgn?: number;
        error?: string;
        pending?: boolean;
        preparing?: boolean;
        message?: string;
        warning?: string;
        order?: { reference: string };
      };

      if (data.pending || response.status >= 500) {
        setPending({
          reference: data.order?.reference,
          message: data.message ?? "We could not confirm the purchase. Your wallet may have been charged. Check your orders or contact support before trying again.",
        });
        return;
      }
      if (response.status === 401) {
        setNeedsSignIn(true);
        setBuyError("Please sign in to complete this purchase.");
        return;
      }
      if (!response.ok || !data.ok) {
        setBuyError(data.error ?? "That purchase could not be completed.");
        return;
      }

      // A hand-prepared item is paid for but not delivered yet. Showing an empty
      // credential list would look like a failed order, so it gets its own state.
      if (data.preparing) {
        setPreparing({
          reference: data.order?.reference,
          message: data.message ?? "Your order is confirmed and being prepared. Your credentials appear on the order page as soon as they are ready.",
        });
        void loadListings();
        return;
      }

      setResult({
        accounts: data.accounts ?? [],
        reference: data.order?.reference ?? "—",
        totalNgn: data.totalNgn ?? estimatedTotal,
        warning: data.warning,
      });
      void loadListings();
    } catch {
      setPending({ message: "We could not confirm the purchase. Your wallet may have been charged. Check your orders or contact support before trying again." });
    } finally {
      setBuying(false);
    }
  }

  async function copy(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(index);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // Clipboard is blocked outside a secure context — the text is selectable anyway.
    }
  }

  if (!configured) {
    // Checkout is not configured, so offer a way onward rather than a dead end.
    return (
      <div className="rounded-2xl border border-line bg-white p-8 text-center">
        <h2 className="text-[1rem] font-semibold text-ink">
          Accounts are almost ready
        </h2>
        <p className="mx-auto mt-2 max-w-md text-[0.875rem] leading-relaxed text-ink-2">
          Our account marketplace is being prepared. You can explore the other services in the
          meantime.
        </p>
        <Link
          href="/virtual-numbers"
          className="btn btn-primary mt-5 inline-flex"
        >
          Explore other services
        </Link>
      </div>
    );
  }

  return (
    <div>
      {!purchaseEnabled && (
        <div role="status" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-[0.875rem] text-amber-900">
          Account purchases are temporarily paused. You can browse listings, but checkout is unavailable.
        </div>
      )}
      {/* Checkout is open, but not for hand-prepared items. Without this the
          customer sees "Paused" on some cards and no reason anywhere. Wording
          stays customer-facing: why they are paused is not their concern. */}
      {purchaseEnabled && visibleListings.some((listing) => listing.fulfilment === "manual" && !listing.purchasable) && (
        <div role="status" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-[0.875rem] text-amber-900">
          Items marked <strong>Prepared for you</strong> cannot be ordered right now. Every other listing is
          subject to its own stock and checkout checks.
        </div>
      )}
      {/* Filters */}
      <div className="flex flex-col gap-4">
        {categoryError && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[0.8125rem] text-amber-900">{categoryError}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => selectCategory(null)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-[0.8125rem] font-medium transition-colors",
              activeCategory === null
                ? "border-lav-600 bg-lav-700 text-white"
                : "border-line bg-white text-ink-2 hover:border-lav-300",
            )}
          >
            All accounts
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => selectCategory(category.id)}
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-[0.8125rem] font-medium transition-colors",
                activeCategory === category.id
                  ? "border-lav-600 bg-lav-700 text-white"
                  : "border-line bg-white text-ink-2 hover:border-lav-300",
              )}
            >
              {category.title}
            </button>
          ))}
        </div>

        {accountChoices.length > 0 ? <QuickShortcuts
          label="Find accounts by platform"
          title="Find a platform:"
          description="Shortcuts come from this loaded page. They search all currently available listings; stock can change."
          options={accountChoices}
          selected={shortcutSelection?.key ?? null}
          onSelect={(key) => {
            const choice = accountChoices.find((option) => option.key === key);
            if (!choice) return;
            selectCategory(null);
            setShortcutSelection(choice);
            setSearchInput(choice.query);
            setSearch(choice.query);
            setPage(1);
          }}
          onClear={clearFilters}
          clearLabel="Clear filters"
          alwaysShowClear
        /> : (searchInput || activeCategory !== null) && <button type="button" onClick={clearFilters} className="self-start text-meta font-semibold text-lav-700 hover:underline">Clear filters</button>}
        <label className="flex items-center gap-2 text-[0.875rem] text-ink-2">
          <input type="checkbox" checked={inStockOnly} onChange={(event) => { setInStockOnly(event.target.checked); setPage(1); }} />
          In stock only
        </label>
        <p className="text-meta text-ink-3">
          Search covers all currently available listings, not just this page. Prices are lowest first by default.
          Uncheck “In stock only” to include sold-out and unconfirmed-stock listings from connected catalogues.
        </p>

        {activeCategory !== null && subcategories.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line/60 pt-3">
            <button
              type="button"
              onClick={() => selectSubcategory(null)}
              className={cn(
                "rounded-full border px-3 py-1 text-meta",
                activeSubcategory === null
                  ? "border-ink bg-ink text-white"
                  : "border-line bg-cream text-ink-2",
              )}
            >
              All
            </button>
            {(showAllSubcategories ? subcategories : subcategories.slice(0, 8)).map((subcategory) => (
              <button
                key={subcategory.id}
                type="button"
                onClick={() => selectSubcategory(subcategory.id)}
                className={cn(
                  "rounded-full border px-3 py-1 text-meta",
                  activeSubcategory === subcategory.id
                    ? "border-ink bg-ink text-white"
                    : "border-line bg-cream text-ink-2",
                )}
              >
                {subcategory.title}
              </button>
            ))}
            {subcategories.length > 8 && !showAllSubcategories && (
              <button type="button" onClick={() => setShowAllSubcategories(true)}
                className="rounded-full border border-line bg-white px-3 py-1 text-meta font-semibold text-lav-700">
                Show all {subcategories.length} types
              </button>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <input
              type="search"
              value={searchInput}
              onChange={(event) => { setShortcutSelection(null); setSearchInput(event.target.value); }}
              placeholder="Search accounts (e.g. facebook, gmail)"
              aria-label="Search accounts"
              className="w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[0.875rem] text-ink outline-none placeholder:text-ink-3 focus:border-lav-400"
            />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="sort" className="text-meta text-ink-3">
              Sort
            </label>
            <select
              id="sort"
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as (typeof SORTS)[number]["value"]);
                setPage(1);
              }}
              className="rounded-xl border border-line bg-white px-3 py-2 text-[0.8125rem] text-ink outline-none focus:border-lav-400"
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {matchesQuery && partial && <p role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-meta text-amber-900">Some account listings could not be loaded. Prices are sorted across the listings currently available; the complete catalogue may contain other offers. Try refreshing shortly.</p>}
      {matchesQuery && stale && <p role="status" className="mt-4 text-meta text-amber-800">The latest catalogue refresh was delayed. These listings may have changed.</p>}
      {/* Results */}
      <div className="mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-meta text-ink-3">
          <span>{isLoading ? "Loading listings…" : matchesQuery && lastChecked ? `Catalogue snapshot from ${lastChecked}. Stock may change; checked again at checkout.` : "Stock snapshot time unavailable. Stock is checked again at checkout."}</span>
          <button type="button" disabled={isLoading} onClick={() => void loadListings()} className="font-semibold text-lav-700 hover:underline disabled:opacity-50">Reload listings</button>
        </div>
        {currentError && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[0.875rem] text-red-800">
            {currentError}{" "}
            {showingPrevious && "Previously loaded listings remain below, but checkout is paused until a refresh succeeds. "}
            <button type="button" onClick={() => void loadListings()} className="font-semibold underline">
              Retry
            </button>
          </div>
        )}

        {isLoading && visibleListings.length === 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-36 animate-pulse rounded-2xl border border-line bg-cream" />
            ))}
          </div>
        )}

        {!isLoading && !currentError && visibleListings.length === 0 && (
          <div className="rounded-2xl border border-line bg-white p-10 text-center">
            <p className="text-[0.9375rem] font-semibold text-ink">No accounts match those filters</p>
            <p className="mt-1 text-[0.8125rem] text-ink-2">
              Try another platform or clear your search. Uncheck “In stock only” to include sold-out listings.
            </p>
          </div>
        )}

        {visibleListings.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleListings.map((listing) => (
              <article key={listing.id} className="flex flex-col rounded-2xl border border-line bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <PlatformBadge
                      platform={platformFor(listing.title, listing.category, listing.subcategory)}
                      size={34}
                    />
                    <h3 className="text-[0.875rem] font-semibold leading-snug text-ink">{listing.title}</h3>
                  </div>
                </div>

                <p className="mt-1.5 text-meta text-ink-3">
                  {[listing.category, listing.subcategory].filter(Boolean).join(" · ") || "Digital account"}
                  {(listing.sold ?? 0) > 0 ? ` · ${(listing.sold as number).toLocaleString("en-NG")} sold` : ""}
                </p>

                <div className="mt-3">
                  {listing.stock === null && listing.fulfilment === "manual" ? (
                    // No published count exists for this item, so say how it is
                    // delivered instead of showing a number nobody has.
                    <p className="inline-flex items-center rounded-lg bg-cream px-2 py-1 text-meta font-medium text-ink-2">
                      Confirmed after payment
                    </p>
                  ) : (
                    <UnitsStatus stock={listing.stock} />
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {listing.warrantyDays !== null && listing.warrantyDays > 0 && (
                    <span className="rounded-full bg-lav-50 px-2 py-0.5 text-micro font-semibold text-lav-800">
                      {warrantyBadge(listing.warrantyDays)}
                    </span>
                  )}
                  {listing.fulfilment === "manual" && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-micro font-semibold text-amber-800">
                      Prepared for you
                    </span>
                  )}
                </div>

                <div className="mt-4 flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[1rem] font-semibold text-ink">{formatNaira(listing.priceNgn)}</p>
                    <p className="text-meta text-ink-3">per account</p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => openBuy(listing)}
                    disabled={!canBuy(listing)}
                  >
                    {purchaseEnabled && listing.purchasable ? "Buy" : "Paused"}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}

        {matchesQuery && meta && (meta.last_page > 1 || page > 1) && (
          <div className="mt-6 flex items-center justify-between gap-3">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1 || isLoading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </Button>
            <p className="text-meta text-ink-3">
              Page {meta.current_page} of {meta.last_page} · {meta.total.toLocaleString("en-NG")} listings
            </p>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= meta.last_page || isLoading}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </div>

      {/* Purchase modal */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-4 backdrop-blur-sm sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label={
            result
              ? "Purchase complete"
              : preparing
                ? "Order confirmed"
                : pending
                  ? "Purchase review"
                  : "Buy accounts"
          }
          onClick={(event) => {
            if (event.target === event.currentTarget && !buying) {
              setSelected(null);
              setResult(null);
              setPreparing(null);
            }
          }}
        >
          <div className="w-full max-w-lg rounded-2xl border border-line bg-white p-5 shadow-xl">
            {result ? (
              <div>
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                    ✓
                  </span>
                  <h3 className="text-[1rem] font-semibold text-ink">Delivered — {result.accounts.length} account(s)</h3>
                </div>
                <p className="mt-1 text-[0.8125rem] text-ink-2">
                  Reference <span className="font-semibold text-ink">{result.reference}</span> ·{" "}
                  {formatNaira(result.totalNgn)} charged to your wallet
                </p>

                <div className="mt-4 max-h-64 space-y-2 overflow-y-auto rounded-xl border border-line bg-cream/60 p-3">
                  {result.accounts.map((account, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <code className="flex-1 break-all rounded-lg bg-white px-2.5 py-1.5 font-mono text-meta text-ink">
                        {account}
                      </code>
                      <button
                        type="button"
                        onClick={() => void copy(account, index)}
                        className="shrink-0 rounded-lg border border-line bg-white px-2 py-1 text-meta font-semibold text-ink-2 hover:border-lav-300"
                      >
                        {copied === index ? "Copied" : "Copy"}
                      </button>
                    </div>
                  ))}
                </div>

                <p className="mt-3 text-meta text-ink-3">
                  Save these now and treat them like passwords.
                </p>
                {result.warning && (
                  <p role="alert" className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[0.8125rem] text-amber-900">
                    {result.warning}
                  </p>
                )}

                <div className="mt-5 flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      void navigator.clipboard.writeText(result.accounts.join("\n")).catch(() => undefined);
                    }}
                  >
                    Copy all
                  </Button>
                  <Link href="/dashboard/orders" className="btn btn-primary inline-flex items-center">
                    View orders
                  </Link>
                </div>
              </div>
            ) : preparing ? (
              <div>
                <h3 className="text-[1rem] font-semibold text-ink">Order confirmed — being prepared</h3>
                <p role="status" className="mt-3 text-[0.875rem] leading-relaxed text-ink-2">
                  {preparing.message}
                </p>
                {preparing.reference && (
                  <p className="mt-2 break-all text-[0.8125rem] font-semibold text-ink">
                    Reference: {preparing.reference}
                  </p>
                )}
                <div className="mt-5 flex flex-wrap gap-2">
                  <Link href="/dashboard/orders" className="btn btn-primary inline-flex items-center">View orders</Link>
                  <Link href="/dashboard/support" className="btn btn-secondary inline-flex items-center">Contact support</Link>
                  <Button variant="ghost" onClick={() => { setSelected(null); setPreparing(null); }}>Close</Button>
                </div>
              </div>
            ) : pending ? (
              <div>
                <h3 className="text-[1rem] font-semibold text-ink">Purchase needs review</h3>
                <p role="status" className="mt-3 text-[0.875rem] text-ink-2">{pending.message}</p>
                {pending.reference && <p className="mt-2 break-all text-[0.8125rem] font-semibold text-ink">Reference: {pending.reference}</p>}
                <div className="mt-5 flex flex-wrap gap-2">
                  <Link href="/dashboard/orders" className="btn btn-primary inline-flex items-center">View orders</Link>
                  <Link href="/dashboard/support" className="btn btn-secondary inline-flex items-center">Contact support</Link>
                  <Button variant="ghost" onClick={() => setSelected(null)}>Close</Button>
                </div>
              </div>
            ) : (
              <div>
                <h3 className="text-[1rem] font-semibold text-ink">{selected.title}</h3>
                <p className="mt-1 text-[0.8125rem] text-ink-2">
                  {formatNaira(selected.priceNgn)} per account ·{" "}
                  {selected.stock === null
                    ? selected.fulfilment === "manual"
                      ? "Confirmed after payment"
                      : "Stock unknown"
                    : `${selected.stock} in stock when last checked`}
                </p>
                {(selected.warrantyDays ?? 0) > 0 && (
                  <p className="mt-1 text-meta text-ink-3">
                    {warrantyLabel(selected.warrantyDays)} on this item.
                  </p>
                )}
                {selected.fulfilment === "manual" && (
                  <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-meta leading-relaxed text-amber-900">
                    This item is prepared for you after payment rather than delivered instantly. It
                    appears on your order page as soon as it is confirmed.
                  </p>
                )}

                <div className="mt-4 flex items-center justify-between gap-3">
                  <label htmlFor="quantity" className="text-[0.8125rem] font-medium text-ink">
                    Quantity
                  </label>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setPromo(null);
                        setPromoMessage(null);
                        setQuantity((q) => Math.max(selected.minQuantity, q - 1));
                      }}
                      disabled={quantity <= selected.minQuantity}
                      aria-label="Decrease quantity"
                    >
                      −
                    </Button>
                    <input
                      id="quantity"
                      type="number"
                      min={selected.minQuantity}
                      max={selected.maxQuantity}
                      value={quantity}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (Number.isFinite(next)) {
                          setPromo(null);
                          setPromoMessage(null);
                          setQuantity(Math.min(selected.maxQuantity, Math.max(selected.minQuantity, Math.floor(next))));
                        }
                      }}
                      className="w-16 rounded-lg border border-line bg-white px-2 py-1.5 text-center text-[0.875rem] text-ink outline-none focus:border-lav-400"
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setPromo(null);
                        setPromoMessage(null);
                        setQuantity((q) => Math.min(selected.maxQuantity, q + 1));
                      }}
                      disabled={quantity >= selected.maxQuantity}
                      aria-label="Increase quantity"
                    >
                      +
                    </Button>
                  </div>
                </div>

                <div className="mt-4">
                  <label htmlFor="promo" className="text-meta font-medium text-ink-2">
                    Promo code
                  </label>
                  <div className="mt-1.5 flex gap-2">
                    <input
                      id="promo"
                      value={promoInput}
                      onChange={(event) => setPromoInput(event.target.value.toUpperCase())}
                      placeholder="Optional"
                      autoComplete="off"
                      className="min-w-0 flex-1 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[0.8125rem] uppercase tracking-wide text-ink outline-none placeholder:normal-case placeholder:tracking-normal placeholder:text-ink-3 focus:border-lav-400"
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => void applyPromo()}
                      loading={promoBusy}
                      disabled={promoBusy || !promoInput.trim()}
                    >
                      Apply
                    </Button>
                  </div>
                  {promo && <p className="mt-1.5 text-meta font-medium text-emerald-700">{promo.message}</p>}
                  {promoMessage && !promo && <p className="mt-1.5 text-meta text-red-700">{promoMessage}</p>}
                </div>

                <div className="mt-4 rounded-xl border border-line bg-cream/70 p-3">
                  <div className="flex items-center justify-between text-[0.875rem]">
                    <span className="text-ink-2">Total</span>
                    <span className="font-semibold text-ink">{formatNaira(estimatedTotal)}</span>
                  </div>
                  <p className="mt-1 text-meta text-ink-3">
                    Paid from your PryvaLogs wallet. Volume discounts apply automatically at 5, 10 and 25
                    accounts. Final total is confirmed by the server.
                  </p>
                  {promo && (
                    <p className="mt-1 text-meta font-medium text-emerald-700">
                      {promo.code} applied — you save {formatNaira(promo.savedNgn)}.
                    </p>
                  )}
                </div>

                {buyError && (
                  <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[0.8125rem] text-red-800">
                    {buyError}
                    {needsSignIn && (
                      <>
                        {" "}
                        <Link href="/login?next=/accounts" className="font-semibold underline">
                          Sign in
                        </Link>
                      </>
                    )}
                  </div>
                )}

                {!canBuy(selected) && <p role="status" className="mt-3 text-meta text-amber-800">This listing needs a fresh availability check. Close this window and choose the current listing again.</p>}
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button onClick={() => void buy()} loading={buying} disabled={
                        !canBuy(selected) ||
                        quantity < selected.minQuantity ||
                        quantity > selected.maxQuantity ||
                        (selected.stock !== null && selected.stock < quantity)
                      }>
                    {buying ? "Buying…" : `Pay ${formatNaira(estimatedTotal)}`}
                  </Button>
                  <Button variant="ghost" onClick={() => setSelected(null)} disabled={buying}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
