"use client";

import { useState, useEffect, useRef } from "react";
import { formatNaira } from "@/lib/catalog";
import { Gift, Copy, Check, ShoppingCart, Shield } from "@/components/icons";
import { useRouter } from "next/navigation";
import { PaymentLoading } from "@/components/ui/PaymentLoading";
import { fireConfetti } from "@/components/ui/Confetti";
import { BrandIcon } from "@/components/BrandIcon";
import { BRAND_GIFT_CARDS, type BrandGiftCardCatalogEntry } from "@/lib/gift-cards-catalog";
import type { GiftCard } from "@/db/schema";
import type { PublicUser } from "@/lib/auth";

interface GiftCardsManagerProps {
  user: PublicUser;
}

type Tab = "brands" | "create" | "redeem" | "history";

const TAB_LABELS: Record<Tab, string> = {
  brands: "Brand Gift Cards",
  create: "Send Wallet Credit",
  redeem: "Redeem Code",
  history: "History",
};

export function GiftCardsManager({ user }: GiftCardsManagerProps) {
  const router = useRouter();
  const creating = useRef(false);
  const redeeming = useRef(false);
  const orderingBrand = useRef(false);

  const [activeTab, setActiveTab] = useState<Tab>("brands");

  // Brand Gift Card Store State
  const [selectedBrandSlug, setSelectedBrandSlug] = useState<string>("steam");
  const selectedBrand = BRAND_GIFT_CARDS.find((b) => b.slug === selectedBrandSlug) ?? BRAND_GIFT_CARDS[0];
  const [selectedDenomId, setSelectedDenomId] = useState<string>(
    selectedBrand.denominations.find((d) => d.popular)?.id ?? selectedBrand.denominations[0].id,
  );
  const selectedDenom =
    selectedBrand.denominations.find((d) => d.id === selectedDenomId) ?? selectedBrand.denominations[0];

  const [brandOrderLoading, setBrandOrderLoading] = useState(false);
  const [brandOrderSuccess, setBrandOrderSuccess] = useState<{
    code: string;
    reference: string;
    cardName: string;
    denomination: string;
    instructions: string;
  } | null>(null);
  const [brandOrderError, setBrandOrderError] = useState<string | null>(null);

  // Pryva Internal Wallet Card State
  const [amount, setAmount] = useState<number>(5000);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<{ code: string; amount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemLoading, setRedeemLoading] = useState(false);
  const [redeemSuccess, setRedeemSuccess] = useState<number | null>(null);
  const [cards, setCards] = useState<GiftCard[]>([]);
  const [historyState, setHistoryState] = useState<"loading" | "ready" | "error">("loading");
  const [historyReload, setHistoryReload] = useState(0);
  const [copied, setCopied] = useState<string | null>(null);

  // When selected brand changes, default to its first/popular denomination
  function handleSelectBrand(slug: string) {
    setSelectedBrandSlug(slug);
    setBrandOrderError(null);
    setBrandOrderSuccess(null);
    const brand = BRAND_GIFT_CARDS.find((b) => b.slug === slug);
    if (brand) {
      const preferred = brand.denominations.find((d) => d.popular) ?? brand.denominations[0];
      setSelectedDenomId(preferred.id);
    }
  }

  useEffect(() => {
    if (activeTab !== "history") return;
    const controller = new AbortController();
    fetch("/api/gift-cards/history", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.ok || !Array.isArray(data.cards)) throw new Error("History unavailable");
        if (!controller.signal.aborted) {
          setCards(data.cards);
          setHistoryState("ready");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setHistoryState("error");
      });
    return () => controller.abort();
  }, [activeTab, historyReload]);

  async function handleBrandOrder() {
    if (orderingBrand.current) return;
    orderingBrand.current = true;
    setBrandOrderLoading(true);
    setBrandOrderError(null);
    setBrandOrderSuccess(null);

    const requestId = crypto.randomUUID();

    try {
      const response = await fetch("/api/gift-cards/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          denominationId: selectedDenom.id,
          requestId,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        setBrandOrderError(data.error || "Order failed. Please check your balance and try again.");
        return;
      }

      fireConfetti();
      setBrandOrderSuccess({
        code: data.code,
        reference: data.reference,
        cardName: data.card?.name ?? selectedBrand.name,
        denomination: data.card?.denomination ?? `$${selectedDenom.amountUsd} USD`,
        instructions: data.card?.instructions ?? selectedBrand.redemptionGuide,
      });
      router.refresh();
    } catch {
      setBrandOrderError("Failed to process your gift card order. Please check your wallet before trying again.");
    } finally {
      setBrandOrderLoading(false);
      orderingBrand.current = false;
    }
  }

  async function handleCreate() {
    if (creating.current) return;
    creating.current = true;
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const [response] = await Promise.all([
        fetch("/api/gift-cards/purchase", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount,
            recipientEmail: recipientEmail.trim() || undefined,
            message: message.trim() || undefined,
          }),
        }),
        new Promise((resolve) => setTimeout(resolve, 1600)),
      ]);

      const data = await response.json();

      if (!response.ok || !data.ok) {
        setError(response.status >= 500 ? "Could not confirm the purchase. Check gift card history and wallet activity before trying again." : data.error || "Purchase failed");
        return;
      }

      fireConfetti();
      setSuccess({ code: data.code, amount: data.amount });
      router.refresh();
      setAmount(5000);
      setRecipientEmail("");
      setMessage("");
    } catch {
      setError("Could not confirm the purchase. Check gift card history and wallet activity before trying again.");
    } finally {
      setLoading(false);
      creating.current = false;
    }
  }

  async function handleRedeem() {
    if (redeeming.current) return;
    redeeming.current = true;
    setRedeemLoading(true);
    setError(null);
    setRedeemSuccess(null);

    try {
      const [response] = await Promise.all([
        fetch("/api/gift-cards/redeem", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: redeemCode.trim() }),
        }),
        new Promise((resolve) => setTimeout(resolve, 1600)),
      ]);

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Redemption failed");
      }

      fireConfetti();
      setRedeemSuccess(data.amount);
      setRedeemCode("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Redemption failed");
    } finally {
      setRedeemLoading(false);
      redeeming.current = false;
    }
  }

  function copyCode(code: string) {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(code);
      setTimeout(() => setCopied(null), 2000);
    }).catch(() => undefined);
  }

  const presetAmounts = [1000, 2000, 5000, 10000, 25000, 50000, 100000];

  return (
    <>
      <PaymentLoading show={loading || redeemLoading || brandOrderLoading} message="Processing your order..." />
      <div className="space-y-6">
        {/* Tabs */}
        <div className="flex flex-wrap gap-2 border-b border-line">
          {(["brands", "create", "redeem", "history"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => {
                setError(null);
                setBrandOrderError(null);
                if (tab === "history") {
                  setHistoryState("loading");
                  if (activeTab === "history") setHistoryReload((value) => value + 1);
                }
                setActiveTab(tab);
              }}
              className={`px-4 py-2 text-[0.9rem] font-medium transition-colors ${
                activeTab === tab
                  ? "border-b-2 border-lav-600 text-lav-600 font-semibold"
                  : "text-ink-2 hover:text-ink"
              }`}
            >
              {TAB_LABELS[tab]}
            </button>
          ))}
        </div>

        {/* Brand Gift Cards Tab */}
        {activeTab === "brands" && (
          <div className="space-y-8">
            {/* Brand Selection Grid */}
            <div>
              <label className="block text-[0.86rem] font-semibold text-ink mb-3">
                Select Gift Card Brand
              </label>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {BRAND_GIFT_CARDS.map((brand) => (
                  <button
                    key={brand.slug}
                    type="button"
                    onClick={() => handleSelectBrand(brand.slug)}
                    aria-pressed={selectedBrandSlug === brand.slug}
                    className={`flex flex-col items-center gap-2.5 rounded-2xl border p-4 text-center transition-all ${
                      selectedBrandSlug === brand.slug
                        ? "border-lav-600 bg-lav-50/80 shadow-sm"
                        : "border-line bg-white hover:bg-cream/60"
                    }`}
                  >
                    <BrandIcon brand={brand.brand} size={44} variant="tile" decorative />
                    <div>
                      <p className="text-[0.92rem] font-bold text-ink">{brand.name}</p>
                      <p className="text-meta text-ink-3 uppercase tracking-wider font-medium">{brand.region}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Selected Brand Details & Denomination Picker */}
            <div className="rounded-2xl border border-line bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line/60 pb-5">
                <div className="flex items-center gap-3">
                  <BrandIcon brand={selectedBrand.brand} size={42} variant="tile" decorative />
                  <div>
                    <h2 className="text-[1.2rem] font-bold text-ink">{selectedBrand.name}</h2>
                    <p className="text-[0.82rem] text-ink-2">{selectedBrand.tagline}</p>
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-micro font-semibold text-emerald-800 border border-emerald-200/60">
                  <Shield className="h-3.5 w-3.5 text-emerald-600" /> Instant Code Delivery
                </span>
              </div>

              {/* Denominations */}
              <div className="mt-6">
                <label className="block text-[0.86rem] font-semibold text-ink mb-3">
                  Select Denomination
                </label>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {selectedBrand.denominations.map((denom) => (
                    <button
                      key={denom.id}
                      type="button"
                      onClick={() => {
                        setSelectedDenomId(denom.id);
                        setBrandOrderError(null);
                        setBrandOrderSuccess(null);
                      }}
                      className={`relative flex flex-col justify-between rounded-xl border p-4 text-left transition-all ${
                        selectedDenomId === denom.id
                          ? "border-lav-600 bg-lav-50 ring-2 ring-lav-600/20"
                          : "border-line bg-white hover:border-lav-300"
                      }`}
                    >
                      {denom.popular && (
                        <span className="absolute -top-2.5 right-3 rounded-full bg-lav-600 px-2 py-0.5 text-micro font-bold uppercase tracking-wider text-white">
                          Popular
                        </span>
                      )}
                      <div>
                        <p className="text-[1.15rem] font-extrabold text-ink">${denom.amountUsd} USD</p>
                        <p className="text-[0.8rem] text-ink-3">Digital Voucher</p>
                      </div>
                      <p className="mt-3 text-[1rem] font-bold text-lav-700">
                        {formatNaira(denom.priceNgn)}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Order Error */}
              {brandOrderError && (
                <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-[0.88rem] text-red-700">
                  {brandOrderError}
                </div>
              )}

              {/* Order Success */}
              {brandOrderSuccess && (
                <div className="flow-arrive mt-6 rounded-xl border border-green-200 bg-green-50 p-6 text-center">
                  <Gift className="mx-auto h-12 w-12 text-green-600 mb-2" />
                  <p className="text-[1.15rem] font-bold text-green-800 mb-1">
                    {brandOrderSuccess.cardName} Delivered!
                  </p>
                  <p className="text-[0.85rem] text-green-700 mb-4">
                    Your code is ready to use immediately. It has also been saved to your orders.
                  </p>
                  <div className="flex items-center justify-center gap-3 rounded-xl bg-white border border-green-200 p-4">
                    <code className="text-[1.25rem] font-mono font-bold tracking-wider text-ink">
                      {brandOrderSuccess.code}
                    </code>
                    <button
                      type="button"
                      aria-label="Copy gift card code"
                      onClick={() => copyCode(brandOrderSuccess.code)}
                      className="rounded-lg p-2 text-ink-2 hover:bg-cream"
                    >
                      {copied === brandOrderSuccess.code ? (
                        <Check className="h-5 w-5 text-green-600" />
                      ) : (
                        <Copy className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                  <div className="mt-4 rounded-xl bg-white/70 border border-green-100 p-3 text-left">
                    <p className="text-meta font-bold uppercase tracking-wider text-green-900 mb-1">How to redeem:</p>
                    <p className="text-[0.84rem] text-ink-2 leading-relaxed">{brandOrderSuccess.instructions}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setBrandOrderSuccess(null)}
                    className="mt-4 text-sm font-semibold text-green-800 underline"
                  >
                    Buy another gift card
                  </button>
                </div>
              )}

              {/* Summary & Checkout Action */}
              {!brandOrderSuccess && (
                <div className="mt-6 border-t border-line/60 pt-5">
                  <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                    <div>
                      <span className="text-[0.82rem] text-ink-3">Your Wallet Balance</span>
                      <p className="text-[1.3rem] font-bold text-ink">{formatNaira(user.walletBalance)}</p>
                    </div>
                    <div className="text-right">
                      <span className="text-[0.82rem] text-ink-3">Total Due</span>
                      <p className="text-[1.4rem] font-extrabold text-lav-700">{formatNaira(selectedDenom.priceNgn)}</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleBrandOrder}
                    disabled={brandOrderLoading || user.walletBalance < selectedDenom.priceNgn}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-lav-600 px-6 py-4 text-[1rem] font-semibold text-white transition-colors hover:bg-lav-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                  >
                    <ShoppingCart className="h-5 w-5" />
                    {brandOrderLoading
                      ? "Purchasing voucher..."
                      : user.walletBalance < selectedDenom.priceNgn
                      ? "Insufficient balance in wallet"
                      : `Pay ${formatNaira(selectedDenom.priceNgn)} with Wallet`}
                  </button>

                  <p className="mt-3 text-center text-meta text-ink-3">
                    Redemption instructions: {selectedBrand.redemptionGuide}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Create Tab (Pryva Internal Wallet Gift Card) */}
        {activeTab === "create" && (
          <div className="space-y-6">
            <div>
              <label className="block text-[0.86rem] font-medium text-ink mb-3">
                Select Amount
              </label>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {presetAmounts.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAmount(preset)}
                    className={`rounded-xl border p-3 text-center transition-colors ${
                      amount === preset
                        ? "border-lav-600 bg-lav-50 text-lav-700"
                        : "border-line bg-white text-ink hover:bg-cream"
                    }`}
                  >
                    {formatNaira(preset)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[0.86rem] font-medium text-ink mb-2">
                Custom Amount (₦1,000 - ₦500,000)
              </label>
              <input
                type="number"
                min={1000}
                max={500000}
                step={100}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
                className="w-full rounded-xl border border-line bg-white px-4 py-3 text-[0.95rem] text-ink outline-none transition-colors focus:border-lav-600"
              />
            </div>

            <div>
              <label className="block text-[0.86rem] font-medium text-ink mb-2">
                Recipient Email (Optional)
              </label>
              <input
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="recipient@example.com"
                className="w-full rounded-xl border border-line bg-white px-4 py-3 text-[0.95rem] text-ink outline-none transition-colors focus:border-lav-600"
              />
            </div>

            <div>
              <label className="block text-[0.86rem] font-medium text-ink mb-2">
                Personal Message (Optional)
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                placeholder="Add a friendly note..."
                className="w-full rounded-xl border border-line bg-white p-4 text-[0.95rem] text-ink outline-none transition-colors focus:border-lav-600"
              />
            </div>

            <div className="rounded-xl border border-line bg-cream p-4">
              <p className="text-[0.86rem] text-ink-2">Wallet Balance</p>
              <p className="text-[1.5rem] font-bold text-ink">
                {formatNaira(user.walletBalance)}
              </p>
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[0.9rem] text-red-700">
                {error}
              </div>
            )}

            {success && (
              <div className="flow-arrive rounded-xl border border-green-200 bg-green-50 p-6 text-center">
                <Gift className="mx-auto h-12 w-12 text-green-600 mb-3" />
                <p className="text-[1.1rem] font-semibold text-green-700 mb-2">
                  Gift Card Created!
                </p>
                <p className="text-[0.9rem] text-green-600 mb-4">
                  Copy and share this code privately. No email is sent automatically.
                </p>
                <div className="flex items-center justify-center gap-2 rounded-xl bg-white p-4">
                  <code className="text-[1.2rem] font-bold text-ink">
                    {success.code}
                  </code>
                  <button
                    type="button"
                    aria-label="Copy gift card code"
                    onClick={() => copyCode(success.code)}
                    className="rounded-lg p-2 text-ink-2 hover:bg-cream"
                  >
                    {copied === success.code ? (
                      <Check className="h-5 w-5 text-green-600" />
                    ) : (
                      <Copy className="h-5 w-5" />
                    )}
                  </button>
                </div>
                <p className="mt-3 text-[0.82rem] text-green-600">
                  Amount: {formatNaira(success.amount)}
                </p>
                <button type="button" onClick={() => setSuccess(null)} className="mt-3 text-sm font-semibold underline">
                  Create another card
                </button>
              </div>
            )}

            {!success && (
              <button
                onClick={handleCreate}
                disabled={loading || amount < 1000 || amount > 500000}
                className="w-full rounded-xl bg-lav-600 px-6 py-4 text-[1rem] font-semibold text-white transition-colors hover:bg-lav-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Creating..." : `Create Gift Card for ${formatNaira(amount)}`}
              </button>
            )}
          </div>
        )}

        {/* Redeem Tab */}
        {activeTab === "redeem" && (
          <div className="space-y-6">
            <div>
              <label className="block text-[0.86rem] font-medium text-ink mb-2">
                Gift Card Code
              </label>
              <input
                type="text"
                value={redeemCode}
                onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
                placeholder="PRYVA-XXXX-XXXX-XXXX"
                className="w-full rounded-xl border border-line bg-white px-4 py-3 text-[0.95rem] text-ink outline-none transition-colors focus:border-lav-600"
              />
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[0.9rem] text-red-700">
                {error}
              </div>
            )}

            {redeemSuccess && (
              <div className="flow-arrive rounded-xl border border-green-200 bg-green-50 p-6 text-center">
                <Check className="mx-auto h-12 w-12 text-green-600 mb-3" />
                <p className="text-[1.1rem] font-semibold text-green-700 mb-2">
                  Gift Card Redeemed!
                </p>
                <p className="text-[1.5rem] font-bold text-green-600">
                  {formatNaira(redeemSuccess)}
                </p>
                <p className="mt-2 text-[0.86rem] text-green-600">
                  Added to your wallet balance
                </p>
                <button type="button" onClick={() => setRedeemSuccess(null)} className="mt-3 text-sm font-semibold underline">
                  Redeem another card
                </button>
              </div>
            )}

            {!redeemSuccess && (
              <button
                onClick={handleRedeem}
                disabled={redeemLoading || !redeemCode}
                className="w-full rounded-xl bg-lav-600 px-6 py-4 text-[1rem] font-semibold text-white transition-colors hover:bg-lav-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {redeemLoading ? "Redeeming..." : "Redeem Gift Card"}
              </button>
            )}
          </div>
        )}

        {/* History Tab */}
        {activeTab === "history" && (
          <div className="space-y-4">
            {historyState === "loading" ? (
              <p className="text-sm text-ink-2">Loading gift card history…</p>
            ) : historyState === "error" ? (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                History could not be loaded. Do not assume a purchase failed; check your wallet and try loading history again.
                <button
                  type="button"
                  className="ml-2 font-semibold underline"
                  onClick={() => {
                    setHistoryState("loading");
                    setHistoryReload((value) => value + 1);
                  }}
                >
                  Retry
                </button>
              </div>
            ) : cards.length === 0 ? (
              <div className="rounded-xl border border-line bg-white p-8 text-center">
                <Gift className="mx-auto h-12 w-12 text-ink-3 mb-3" />
                <p className="text-[0.95rem] text-ink-2">
                  No wallet gift cards purchased yet
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {cards.map((card) => (
                  <div
                    key={card.id}
                    className="flex items-center justify-between rounded-xl border border-line bg-white p-4"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <code className="font-bold text-ink">{card.code}</code>
                        <button
                          type="button"
                          aria-label="Copy gift card code"
                          onClick={() => copyCode(card.code)}
                          className="rounded p-1 text-ink-2 hover:bg-cream"
                        >
                          {copied === card.code ? (
                            <Check className="h-4 w-4 text-green-600" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                      <p className="text-[0.82rem] text-ink-2 mt-1">
                        Expires {new Date(card.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-ink">
                        {formatNaira(card.initialAmount)}
                      </p>
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-micro font-semibold ${
                          card.status === "active"
                            ? "bg-green-100 text-green-700"
                            : card.status === "redeemed"
                            ? "bg-lav-100 text-lav-700"
                            : "bg-red-100 text-red-700"
                        }`}
                      >
                        {card.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
