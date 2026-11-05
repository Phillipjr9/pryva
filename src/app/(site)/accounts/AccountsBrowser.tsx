"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatNaira } from "@/lib/services/catalog";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/platform/utils";
import { PlatformBadge, platformFor } from "@/components/PlatformBadge";
import { UnitsStatus } from "@/components/dashboard/UnitsStatus";
import { fulfilmentLabel, warrantyBadge, warrantyLabel } from "@/lib/services/warranty";

type Category = { id: number; title: string; slug: string };
type Subcategory = { id: number; title: string; slug: string };
type Listing = {
  id: number;
  slug: string;
  title: string;
  stock: number | null;
  sold: number | null;
  category: string | null;
  subcategory: string | null;
  priceNgn: number;
  /** Pryva's own replacement window for this item. */
  warrantyDays: number | null;
  minQuantity: number;
  maxQuantity: number;
  /**
   * Orderable right now. Kept separate from `stock` because a hand-prepared item
   * has no published count — turning "available" into a number would invent one.
   */
  available: boolean;
  /** "instant" delivers on payment; "manual" is confirmed afterwards. */
  fulfilment: "instant" | "manual";
  /**
   * Whether checkout is permitted for this listing, decided server-side.
   *
   * A hand-prepared item can be listed, priced and honestly described and still
   * not be buyable, because preparing it needs someone who can reach the
   * fulfilment queue. Optional so an older response cannot break the type;
   * absent reads as not buyable, which is the safe direction.
   */
  purchasable?: boolean;
};
type Meta = { current_page: number; last_page: number; per_page: number; total: number };
type CheckoutQuote = {
  slug: string; quantity: number; promoCode: string; totalNgn: number; savedNgn: number;
  terms: string; title: string; fulfilment: "instant" | "manual"; warrantyDays: number; stock: number | null;
};

/** Refuse malformed or out-of-date responses instead of enabling a Pay button. */
function readQuote(value: unknown, slug: string, quantity: number, promoCode: string): CheckoutQuote | null {
  if (!value || typeof value !== "object") return null;
  const q = value as Partial<CheckoutQuote>;
  if (q.slug !== slug || q.quantity !== quantity || q.promoCode !== promoCode ||
      !Number.isSafeInteger(q.totalNgn) || (q.totalNgn as number) <= 0 || (q.totalNgn as number) > 2_147_483_647 ||
      !Number.isSafeInteger(q.savedNgn) || (q.savedNgn as number) < 0 ||
      typeof q.terms !== "string" || !/^[a-f0-9]{24}$/.test(q.terms) ||
      typeof q.title !== "string" || !q.title.trim() || q.title.length > 160 ||
      (q.fulfilment !== "instant" && q.fulfilment !== "manual") ||
      !Number.isSafeInteger(q.warrantyDays) || (q.warrantyDays as number) < 0 ||
      (q.stock !== null && (!Number.isSafeInteger(q.stock) || (q.stock as number) < 0))) return null;
  return q as CheckoutQuote;
}

const SORTS = [
  { value: "sort_key", label: "Recommended" },
  { value: "available_stock", label: "Most stock" },
  { value: "title", label: "A–Z" },
] as const;

export function AccountsBrowser({ purchaseEnabled }: { purchaseEnabled: boolean }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [configured, setConfigured] = useState(true);
  const [activeCategory, setActiveCategory] = useState<number | null>(null);
  const [activeSubcategory, setActiveSubcategory] = useState<number | null>(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<(typeof SORTS)[number]["value"]>("sort_key");
  const [page, setPage] = useState(1);

  const [listings, setListings] = useState<Listing[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Listing | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [buying, setBuying] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [result, setResult] = useState<{ accounts: string[]; reference: string; totalNgn: number; warning?: string } | null>(null);
  const [preparing, setPreparing] = useState<{ reference?: string; message: string } | null>(null);
  const [pending, setPending] = useState<{ reference?: string; message: string } | null>(null);
  const purchaseRequestId = useRef<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [promoInput, setPromoInput] = useState("");
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteChanged, setQuoteChanged] = useState(false);
  const quoteSequence = useRef(0);
  const quoteBusy = useRef(false);
  const buyBusy = useRef(false);

  const [needsSignIn, setNeedsSignIn] = useState(false);
  const requestId = useRef(0);

  // Debounce the search box so we don't hammer the provider.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    const url = activeCategory ? `/api/accounts/categories?categoryId=${activeCategory}` : "/api/accounts/categories";

    fetch(url, { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Categories unavailable");
        return response.json();
      })
      .then((data: { configured?: boolean; categories?: Category[]; subcategories?: Subcategory[] }) => {
        if (cancelled) return;
        setCategoryError(null);
        setConfigured(data.configured !== false);
        if (data.categories) setCategories(data.categories);
        setSubcategories(data.subcategories ?? []);
      })
      .catch(() => {
        if (!cancelled) setCategoryError("Could not load all categories. Refresh the page to retry.");
      });

    return () => {
      cancelled = true;
    };
  }, [activeCategory]);

  const loadListings = useCallback(async () => {
    const current = ++requestId.current;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ sort, page: String(page) });
    if (activeCategory) params.set("categoryId", String(activeCategory));
    if (activeSubcategory) params.set("subcategoryId", String(activeSubcategory));
    if (search) params.set("search", search);

    try {
      const response = await fetch(`/api/accounts/listings?${params.toString()}`, { cache: "no-store" });
      const data = (await response.json()) as {
        configured?: boolean;
        listings?: Listing[];
        meta?: Meta;
        error?: string;
      };

      if (current !== requestId.current) return;
      setConfigured(data.configured !== false);
      if (!response.ok) {
        setError(response.status < 500 && typeof data.error === "string" ? data.error : "Could not load accounts. Please try again.");
        setListings([]);
        setMeta(null);
        setLastChecked(null);
        return;
      }
      setListings(data.listings ?? []);
      setMeta(data.meta ?? null);
      setLastChecked(new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
    } catch {
      if (current === requestId.current) {
        setError("Could not load accounts. Check your connection.");
        setListings([]);
        setMeta(null);
        setLastChecked(null);
      }
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [activeCategory, activeSubcategory, search, sort, page]);

  useEffect(() => {
    const version = requestId;
    const timer = setTimeout(() => void loadListings(), 0);
    return () => {
      clearTimeout(timer);
      version.current++;
    };
  }, [loadListings]);

  function selectCategory(id: number | null) {
    setActiveCategory(id);
    setActiveSubcategory(null);
    setPage(1);
  }

  function selectSubcategory(id: number | null) {
    setActiveSubcategory(id);
    setPage(1);
  }

  /**
   * Orderable right now? A hand-prepared item has no published stock count, so
   * availability — not a number — decides whether it can be bought. Inventing a
   * count for it would tell the customer something nobody knows.
   */
  function canBuy(listing: Listing): boolean {
    // `purchasable` already folds in the page-wide checkout gate server-side,
    // plus the extra condition a hand-prepared item needs. Reading the page flag
    // here instead would let a manual listing be bought while nobody can prepare it.
    if (!listing.purchasable || loading || !listing.available) return false;
    return listing.stock === null ? listing.fulfilment === "manual" : listing.stock >= listing.minQuantity;
  }

  function invalidateQuote() {
    quoteSequence.current += 1;
    quoteBusy.current = false;
    setQuoteLoading(false);
    setQuote(null);
    setQuoteChanged(false);
    setBuyError(null);
    setNeedsSignIn(false);
  }

  function closeBuy() {
    if (buyBusy.current) return;
    invalidateQuote();
    setSelected(null);
    setResult(null);
    setPreparing(null);
  }

  function openBuy(listing: Listing) {
    if (!canBuy(listing)) return;
    invalidateQuote();
    purchaseRequestId.current = null;
    setPending(null);
    setPreparing(null);
    setSelected(listing);
    setQuantity(Math.max(1, listing.minQuantity));
    setResult(null);
    setPromoInput("");
  }

  async function reviewPrice() {
    if (!selected || quoteBusy.current || buyBusy.current) return;
    const slug = selected.slug;
    const code = promoInput.trim().toUpperCase();
    const sequence = ++quoteSequence.current;
    quoteBusy.current = true;
    setQuoteLoading(true);
    setQuote(null);
    setQuoteChanged(false);
    setBuyError(null);
    setNeedsSignIn(false);
    try {
      const response = await fetch("/api/accounts/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, quantity, promoCode: code }),
      });
      const data = await response.json() as { ok?: boolean; quote?: unknown; error?: string };
      if (sequence !== quoteSequence.current) return;
      if (response.status === 401) setNeedsSignIn(true);
      if (!response.ok || !data.ok) {
        setBuyError(response.status < 500 && typeof data.error === "string" ? data.error : "Could not review this price. Please try again.");
        return;
      }
      const reviewed = readQuote(data.quote, slug, quantity, code);
      if (!reviewed) {
        setBuyError("Could not verify this price. Please try again.");
        return;
      }
      setQuote(reviewed);
    } catch {
      if (sequence === quoteSequence.current) setBuyError("Could not review this price. Check your connection and try again.");
    } finally {
      if (sequence === quoteSequence.current) {
        quoteBusy.current = false;
        setQuoteLoading(false);
      }
    }
  }

  async function buy() {
    if (!selected || !quote || quoteBusy.current || buyBusy.current ||
        quote.slug !== selected.slug || quote.quantity !== quantity || quote.promoCode !== promoInput.trim().toUpperCase()) return;
    buyBusy.current = true;
    setBuying(true);
    setBuyError(null);

    try {
      purchaseRequestId.current ??= crypto.randomUUID();
      const response = await fetch("/api/accounts/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: quote.slug, quantity: quote.quantity, promoCode: quote.promoCode, requestId: purchaseRequestId.current,
          expectedTotalNgn: quote.totalNgn, expectedTerms: quote.terms,
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean; accounts?: string[]; totalNgn?: number; error?: string; code?: string; quote?: unknown;
        pending?: boolean; preparing?: boolean; message?: string; warning?: string; order?: { reference: string };
      };

      if (data.pending || response.status >= 500) {
        setPending({
          reference: data.order?.reference,
          message: response.status < 500 && typeof data.message === "string" ? data.message : "We could not confirm the purchase. Your wallet may have been charged. Check your orders or contact support before trying again.",
        });
        return;
      }
      if (response.status === 401) {
        setNeedsSignIn(true);
        setBuyError("Please sign in to complete this purchase.");
        return;
      }
      if (response.status === 409 && data.code === "quote_changed") {
        const updated = readQuote(data.quote, quote.slug, quote.quantity, quote.promoCode);
        setQuote(updated);
        setQuoteChanged(Boolean(updated));
        setBuyError(updated
          ? "The price or item details changed. Review the updated total and confirm again."
          : "The price changed. Review it again before ordering.");
        return;
      }
      if (!response.ok || !data.ok) {
        if (response.status !== 402) setQuote(null);
        setBuyError(data.error ?? "That purchase could not be completed.");
        return;
      }

      // A hand-prepared item is paid for but not delivered yet.
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
        totalNgn: data.totalNgn ?? quote.totalNgn,
        warning: data.warning,
      });
      void loadListings();
    } catch {
      setPending({ message: "We could not confirm the purchase. Your wallet may have been charged. Check your orders or contact support before trying again." });
    } finally {
      buyBusy.current = false;
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
        <h2 className="text-[1.05rem] font-semibold text-ink">
          Accounts are almost ready
        </h2>
        <p className="mx-auto mt-2 max-w-md text-[0.88rem] leading-relaxed text-ink-2">
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
        <div role="status" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-[0.85rem] text-amber-900">
          Account purchases are temporarily paused. You can browse listings, but checkout is unavailable.
        </div>
      )}
      {/* Checkout is open, but not for hand-prepared items. Without this the
          customer sees "Paused" on some cards and no reason anywhere. Wording
          stays customer-facing: why they are paused is not their concern. */}
      {purchaseEnabled && listings.some((listing) => listing.fulfilment === "manual" && !listing.purchasable) && (
        <div role="status" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-[0.85rem] text-amber-900">
          Items marked <strong>Prepared for you</strong> cannot be ordered right now. Every other listing is
          available as normal.
        </div>
      )}
      {/* Filters */}
      <div className="flex flex-col gap-4">
        {categoryError && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[0.8rem] text-amber-900">{categoryError}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => selectCategory(null)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-[0.8rem] font-medium transition-colors",
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
                "rounded-full border px-3.5 py-1.5 text-[0.8rem] font-medium transition-colors",
                activeCategory === category.id
                  ? "border-lav-600 bg-lav-700 text-white"
                  : "border-line bg-white text-ink-2 hover:border-lav-300",
              )}
            >
              {category.title}
            </button>
          ))}
        </div>

        {subcategories.length > 0 && (
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
            {subcategories.map((subcategory) => (
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
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search accounts (e.g. facebook, gmail)"
              aria-label="Search accounts"
              className="w-full rounded-xl border border-line bg-white px-3.5 py-2.5 text-[0.88rem] text-ink outline-none placeholder:text-ink-3 focus:border-lav-400"
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
              className="rounded-xl border border-line bg-white px-3 py-2 text-[0.82rem] text-ink outline-none focus:border-lav-400"
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

      {/* Results */}
      <div className="mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-meta text-ink-3">
          <span>{loading ? "Refreshing stock…" : lastChecked ? `Stock checked at ${lastChecked}; it may change.` : "Stock not checked yet."}</span>
          <button type="button" disabled={loading} onClick={() => void loadListings()} className="font-semibold text-lav-700 hover:underline disabled:opacity-50">Refresh stock</button>
        </div>
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[0.85rem] text-red-800">
            {error}{" "}
            <button type="button" onClick={() => void loadListings()} className="font-semibold underline">
              Retry
            </button>
          </div>
        )}

        {loading && listings.length === 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="h-36 animate-pulse rounded-2xl border border-line bg-cream" />
            ))}
          </div>
        )}

        {!loading && !error && listings.length === 0 && (
          <div className="rounded-2xl border border-line bg-white p-10 text-center">
            <p className="text-[0.92rem] font-semibold text-ink">No accounts match those filters</p>
            <p className="mt-1 text-[0.84rem] text-ink-2">
              Try a different category, or clear your search to see everything.
            </p>
          </div>
        )}

        {listings.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((listing) => (
              <article key={listing.id} className="flex flex-col rounded-2xl border border-line bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <PlatformBadge
                      platform={platformFor(listing.title, listing.category, listing.subcategory)}
                      size={34}
                    />
                    <h3 className="text-[0.9rem] font-semibold leading-snug text-ink">{listing.title}</h3>
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
                    <p className="text-[1.05rem] font-semibold text-ink">{formatNaira(listing.priceNgn)}</p>
                    <p className="text-meta text-ink-3">per account</p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => openBuy(listing)}
                    disabled={!canBuy(listing)}
                  >
                    {listing.purchasable ? "Buy" : "Paused"}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}

        {meta && meta.last_page > 1 && (
          <div className="mt-6 flex items-center justify-between gap-3">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1 || loading}
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
              disabled={page >= meta.last_page || loading}
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
              closeBuy();
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
                  <h3 className="text-[1.02rem] font-semibold text-ink">Delivered — {result.accounts.length} account(s)</h3>
                </div>
                <p className="mt-1 text-[0.8rem] text-ink-2">
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
                  <p role="alert" className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[0.8rem] text-amber-900">
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
                <h3 className="text-[1.02rem] font-semibold text-ink">Order confirmed — being prepared</h3>
                <p role="status" className="mt-3 text-[0.85rem] leading-relaxed text-ink-2">
                  {preparing.message}
                </p>
                {preparing.reference && (
                  <p className="mt-2 break-all text-[0.8rem] font-semibold text-ink">
                    Reference: {preparing.reference}
                  </p>
                )}
                <div className="mt-5 flex flex-wrap gap-2">
                  <Link href="/dashboard/orders" className="btn btn-primary inline-flex items-center">View orders</Link>
                  <Link href="/dashboard/support" className="btn btn-secondary inline-flex items-center">Contact support</Link>
                  <Button variant="ghost" onClick={closeBuy}>Close</Button>
                </div>
              </div>
            ) : pending ? (
              <div>
                <h3 className="text-[1.02rem] font-semibold text-ink">Purchase needs review</h3>
                <p role="status" className="mt-3 text-[0.85rem] text-ink-2">{pending.message}</p>
                {pending.reference && <p className="mt-2 break-all text-[0.8rem] font-semibold text-ink">Reference: {pending.reference}</p>}
                <div className="mt-5 flex flex-wrap gap-2">
                  <Link href="/dashboard/orders" className="btn btn-primary inline-flex items-center">View orders</Link>
                  <Link href="/dashboard/support" className="btn btn-secondary inline-flex items-center">Contact support</Link>
                  <Button variant="ghost" onClick={closeBuy}>Close</Button>
                </div>
              </div>
            ) : (
              <div>
                <h3 className="text-[1.02rem] font-semibold text-ink">{quote?.title ?? selected.title}</h3>
                <p className="mt-1 text-[0.8rem] text-ink-2">
                  {!quote && <>Listed {formatNaira(selected.priceNgn)} per account · </>}
                  {(quote ? quote.stock : selected.stock) === null
                    ? (quote?.fulfilment ?? selected.fulfilment) === "manual" ? "Confirmed after payment" : "Stock unknown"
                    : `${quote ? quote.stock : selected.stock} in stock when last checked`}
                </p>
                <p className="mt-1 text-meta text-ink-3">
                  {fulfilmentLabel(quote?.fulfilment ?? selected.fulfilment)} · {warrantyLabel(quote?.warrantyDays ?? selected.warrantyDays) ?? "No replacement warranty listed"}.
                </p>
                {(quote?.fulfilment ?? selected.fulfilment) === "manual" && (
                  <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-meta leading-relaxed text-amber-900">
                    This item is prepared for you after payment rather than delivered instantly. It
                    appears on your order page as soon as it is confirmed.
                  </p>
                )}

                <div className="mt-4 flex items-center justify-between gap-3">
                  <label htmlFor="quantity" className="text-[0.84rem] font-medium text-ink">Quantity</label>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" onClick={() => {
                      invalidateQuote();
                      setQuantity((q) => Math.max(selected.minQuantity, q - 1));
                    }} disabled={buying || quoteLoading || quantity <= selected.minQuantity} aria-label="Decrease quantity">−</Button>
                    <input id="quantity" type="number" min={selected.minQuantity} max={selected.maxQuantity} value={quantity}
                      disabled={buying || quoteLoading}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (Number.isFinite(next)) {
                          invalidateQuote();
                          setQuantity(Math.min(selected.maxQuantity, Math.max(selected.minQuantity, Math.floor(next))));
                        }
                      }}
                      className="w-16 rounded-lg border border-line bg-white px-2 py-1.5 text-center text-[0.85rem] text-ink outline-none focus:border-lav-400" />
                    <Button variant="secondary" size="sm" onClick={() => {
                      invalidateQuote();
                      setQuantity((q) => Math.min(selected.maxQuantity, q + 1));
                    }} disabled={buying || quoteLoading || quantity >= selected.maxQuantity} aria-label="Increase quantity">+</Button>
                  </div>
                </div>

                <div className="mt-4">
                  <label htmlFor="promo" className="text-meta font-medium text-ink-2">Promo code (optional)</label>
                  <input id="promo" value={promoInput} disabled={buying || quoteLoading} maxLength={40}
                    onChange={(event) => { invalidateQuote(); setPromoInput(event.target.value.toUpperCase()); }}
                    placeholder="Enter a code before reviewing" autoComplete="off"
                    className="mt-1.5 w-full rounded-lg border border-line bg-white px-2.5 py-1.5 text-[0.82rem] uppercase tracking-wide text-ink outline-none placeholder:normal-case placeholder:tracking-normal placeholder:text-ink-3 focus:border-lav-400" />
                </div>

                <div className="mt-4 rounded-xl border border-line bg-cream/70 p-3" aria-live="polite">
                  <div className="flex items-center justify-between text-[0.85rem]">
                    <span className="text-ink-2">Total</span>
                    <span className="font-semibold text-ink">{quote ? formatNaira(quote.totalNgn) : "Not reviewed"}</span>
                  </div>
                  <p className="mt-1 text-meta text-ink-3">
                    Review the server-calculated total before paying from your Pryva wallet. The price and item details are checked again when you pay.
                  </p>
                  {quote?.promoCode && (
                    <p className="mt-1 text-meta font-medium text-emerald-700">
                      {quote.promoCode} applied — you save {formatNaira(quote.savedNgn)}.
                    </p>
                  )}
                </div>

                {buyError && (
                  <div role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[0.8rem] text-red-800">
                    {buyError}
                    {needsSignIn && <> <Link href="/login?next=/accounts" className="font-semibold underline">Sign in</Link></>}
                  </div>
                )}

                <div className="mt-5 flex flex-wrap gap-2">
                  {quote ? (
                    <Button onClick={() => void buy()} loading={buying} disabled={buying || quoteLoading}>
                      {buying ? "Buying…" : `${quoteChanged ? "Confirm and pay" : "Pay"} ${formatNaira(quote.totalNgn)}`}
                    </Button>
                  ) : (
                    <Button onClick={() => void reviewPrice()} loading={quoteLoading} disabled={quoteLoading || buying}>
                      {quoteLoading ? "Checking price…" : "Review price"}
                    </Button>
                  )}
                  <Button variant="ghost" onClick={closeBuy} disabled={buying}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
