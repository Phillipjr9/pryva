"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { formatNaira } from "@/lib/catalog";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { PlatformBadge, platformFor } from "@/components/PlatformBadge";
import { UnitsStatus } from "@/components/dashboard/UnitsStatus";

type Category = { id: number; title: string; slug: string };
type Subcategory = { id: number; title: string; slug: string };
type Listing = {
  id: number;
  slug: string;
  title: string;
  stock: number | null;
  sold: number;
  category: string | null;
  subcategory: string | null;
  priceNgn: number;
};
type Meta = { current_page: number; last_page: number; per_page: number; total: number };

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
  const [pending, setPending] = useState<{ reference?: string; message: string } | null>(null);
  const purchaseRequestId = useRef<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [promoInput, setPromoInput] = useState("");
  const [promo, setPromo] = useState<{ code: string; totalNgn: number; savedNgn: number; message: string } | null>(null);
  const [promoBusy, setPromoBusy] = useState(false);
  const [promoMessage, setPromoMessage] = useState<string | null>(null);

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
        setError(data.error ?? "Could not load accounts.");
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

  function openBuy(listing: Listing) {
    if (!purchaseEnabled || loading || listing.stock === null || listing.stock < 1) return;
    purchaseRequestId.current = null;
    setPending(null);
    setSelected(listing);
    setQuantity(1);
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
    if (!selected) return;
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
    return (
      <div className="rounded-2xl border border-line bg-white p-8 text-center">
        <h2 className="text-[1.05rem] font-semibold text-ink">Accounts are almost ready</h2>
        <p className="mx-auto mt-2 max-w-md text-[0.88rem] leading-relaxed text-ink-2">
          Our account marketplace is being prepared. You can explore the other services in the meantime.
        </p>
        <Link href="/virtual-numbers" className="btn btn-primary mt-5 inline-flex">
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
                ? "border-lav-600 bg-lav-600 text-white"
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
                  ? "border-lav-600 bg-lav-600 text-white"
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
                "rounded-full border px-3 py-1 text-[0.76rem]",
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
                  "rounded-full border px-3 py-1 text-[0.76rem]",
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
            <label htmlFor="sort" className="text-[0.78rem] text-ink-3">
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
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[0.72rem] text-ink-3">
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

                <p className="mt-1.5 text-[0.74rem] text-ink-3">
                  {[listing.category, listing.subcategory].filter(Boolean).join(" · ") || "Digital account"}
                  {listing.sold > 0 ? ` · ${listing.sold.toLocaleString("en-NG")} sold` : ""}
                </p>
                <div className="mt-3"><UnitsStatus stock={listing.stock} /></div>

                <div className="mt-4 flex items-end justify-between gap-3">
                  <div>
                    <p className="text-[1.05rem] font-semibold text-ink">{formatNaira(listing.priceNgn)}</p>
                    <p className="text-[0.7rem] text-ink-3">per account</p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => openBuy(listing)}
                    disabled={!purchaseEnabled || loading || listing.stock === null || listing.stock < 1}
                  >
                    {purchaseEnabled ? "Buy" : "Paused"}
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
            <p className="text-[0.78rem] text-ink-3">
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
          aria-label={result ? "Purchase complete" : pending ? "Purchase review" : "Buy accounts"}
          onClick={(event) => {
            if (event.target === event.currentTarget && !buying) {
              setSelected(null);
              setResult(null);
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
                      <code className="flex-1 break-all rounded-lg bg-white px-2.5 py-1.5 font-mono text-[0.76rem] text-ink">
                        {account}
                      </code>
                      <button
                        type="button"
                        onClick={() => void copy(account, index)}
                        className="shrink-0 rounded-lg border border-line bg-white px-2 py-1 text-[0.72rem] font-semibold text-ink-2 hover:border-lav-300"
                      >
                        {copied === index ? "Copied" : "Copy"}
                      </button>
                    </div>
                  ))}
                </div>

                <p className="mt-3 text-[0.74rem] text-ink-3">
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
            ) : pending ? (
              <div>
                <h3 className="text-[1.02rem] font-semibold text-ink">Purchase needs review</h3>
                <p role="status" className="mt-3 text-[0.85rem] text-ink-2">{pending.message}</p>
                {pending.reference && <p className="mt-2 break-all text-[0.8rem] font-semibold text-ink">Reference: {pending.reference}</p>}
                <div className="mt-5 flex flex-wrap gap-2">
                  <Link href="/dashboard/orders" className="btn btn-primary inline-flex items-center">View orders</Link>
                  <Link href="/dashboard/support" className="btn btn-secondary inline-flex items-center">Contact support</Link>
                  <Button variant="ghost" onClick={() => setSelected(null)}>Close</Button>
                </div>
              </div>
            ) : (
              <div>
                <h3 className="text-[1.02rem] font-semibold text-ink">{selected.title}</h3>
                <p className="mt-1 text-[0.8rem] text-ink-2">
                  {formatNaira(selected.priceNgn)} per account · {selected.stock === null ? "Stock unknown" : `${selected.stock} in stock when last checked`}
                </p>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <label htmlFor="quantity" className="text-[0.84rem] font-medium text-ink">
                    Quantity
                  </label>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setPromo(null);
                        setPromoMessage(null);
                        setQuantity((q) => Math.max(1, q - 1));
                      }}
                      disabled={quantity <= 1}
                      aria-label="Decrease quantity"
                    >
                      −
                    </Button>
                    <input
                      id="quantity"
                      type="number"
                      min={1}
                      max={Math.min(50, selected.stock ?? 0)}
                      value={quantity}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (Number.isFinite(next)) {
                          setPromo(null);
                          setPromoMessage(null);
                          setQuantity(Math.min(50, Math.max(1, Math.floor(next))));
                        }
                      }}
                      className="w-16 rounded-lg border border-line bg-white px-2 py-1.5 text-center text-[0.85rem] text-ink outline-none focus:border-lav-400"
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setPromo(null);
                        setPromoMessage(null);
                        setQuantity((q) => Math.min(50, selected.stock ?? 0, q + 1));
                      }}
                      disabled={quantity >= Math.min(50, selected.stock ?? 0)}
                      aria-label="Increase quantity"
                    >
                      +
                    </Button>
                  </div>
                </div>

                <div className="mt-4">
                  <label htmlFor="promo" className="text-[0.78rem] font-medium text-ink-2">
                    Promo code
                  </label>
                  <div className="mt-1.5 flex gap-2">
                    <input
                      id="promo"
                      value={promoInput}
                      onChange={(event) => setPromoInput(event.target.value.toUpperCase())}
                      placeholder="Optional"
                      autoComplete="off"
                      className="min-w-0 flex-1 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[0.82rem] uppercase tracking-wide text-ink outline-none placeholder:normal-case placeholder:tracking-normal placeholder:text-ink-3 focus:border-lav-400"
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
                  {promo && <p className="mt-1.5 text-[0.75rem] font-medium text-emerald-700">{promo.message}</p>}
                  {promoMessage && !promo && <p className="mt-1.5 text-[0.75rem] text-red-700">{promoMessage}</p>}
                </div>

                <div className="mt-4 rounded-xl border border-line bg-cream/70 p-3">
                  <div className="flex items-center justify-between text-[0.85rem]">
                    <span className="text-ink-2">Total</span>
                    <span className="font-semibold text-ink">{formatNaira(estimatedTotal)}</span>
                  </div>
                  <p className="mt-1 text-[0.72rem] text-ink-3">
                    Paid from your Pryva wallet. Volume discounts apply automatically at 5, 10 and 25
                    accounts. Final total is confirmed by the server.
                  </p>
                  {promo && (
                    <p className="mt-1 text-[0.72rem] font-medium text-emerald-700">
                      {promo.code} applied — you save {formatNaira(promo.savedNgn)}.
                    </p>
                  )}
                </div>

                {buyError && (
                  <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[0.8rem] text-red-800">
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

                <div className="mt-5 flex flex-wrap gap-2">
                  <Button onClick={() => void buy()} loading={buying} disabled={selected.stock === null || selected.stock < 1}>
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
