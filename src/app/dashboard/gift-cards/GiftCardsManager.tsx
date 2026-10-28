"use client";

import { useState, useEffect, useRef } from "react";
import { formatNaira } from "@/lib/catalog";
import { Gift, Copy, Check } from "@/components/icons";
import { useRouter } from "next/navigation";
import { PaymentLoading } from "@/components/ui/PaymentLoading";
import { fireConfetti } from "@/components/ui/Confetti";
import type { GiftCard } from "@/db/schema";
import type { PublicUser } from "@/lib/auth";

interface GiftCardsManagerProps {
  user: PublicUser;
  preview?: boolean;
}

type Tab = "create" | "redeem" | "history";

export function GiftCardsManager({ user, preview = false }: GiftCardsManagerProps) {
  const router = useRouter();
  const attempt = useRef<{ amount: number; requestId: string } | null>(null);
  const creating = useRef(false);
  const redeeming = useRef(false);
  const [activeTab, setActiveTab] = useState<Tab>("create");
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

  async function handleCreate() {
    if (creating.current) return;
    if (preview && attempt.current && attempt.current.amount !== amount) {
      setError("Check your gift card history and retry the previous amount before starting another.");
      return;
    }
    creating.current = true;
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      if (preview) attempt.current ??= { amount, requestId: crypto.randomUUID() };
      const [response] = await Promise.all([
        fetch(preview ? "/api/demo/gift-cards/create" : "/api/gift-cards/purchase", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(preview ? attempt.current : { amount, recipientEmail: recipientEmail || undefined, message: message || undefined }),
        }),
        new Promise((resolve) => setTimeout(resolve, 1600)),
      ]);

      const data = await response.json();

      if (!response.ok || !data.ok || (preview && !data.simulated)) {
        if (preview && response.status >= 400 && response.status < 500 && response.status !== 409) attempt.current = null;
        setError(response.status >= 500 ? "Could not confirm the purchase. Check gift card history and wallet activity before trying again." : data.error || "Purchase failed");
        return;
      }

      attempt.current = null;
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
        fetch(preview ? "/api/demo/gift-cards/redeem" : "/api/gift-cards/redeem", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: redeemCode }),
        }),
        new Promise((resolve) => setTimeout(resolve, 1600)),
      ]);

      const data = await response.json();

      if (!response.ok || !data.ok || (preview && !data.simulated)) {
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

  const presetAmounts = [2000, 5000, 10000, 25000, 50000];

  return (
    <>
      <PaymentLoading show={loading || redeemLoading} message="Processing your gift card..." />
      <div className="space-y-6">
        {/* Tabs */}
        <div className="flex gap-2 border-b border-line">
          {(["create", "redeem", "history"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => {
                setError(null);
                if (tab === "history") {
                  setHistoryState("loading");
                  if (activeTab === "history") setHistoryReload((value) => value + 1);
                }
                setActiveTab(tab);
              }}
              className={`px-4 py-2 text-[0.9rem] font-medium transition-colors ${
                activeTab === tab
                  ? "border-b-2 border-lav-600 text-lav-600"
                  : "text-ink-2 hover:text-ink"
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

      {/* Create Tab */}
      {activeTab === "create" && (
        <div className="space-y-6">
          {/* Preset Amounts */}
          <div>
            <label className="block text-[0.86rem] font-medium text-ink mb-3">
              Select Amount
            </label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {presetAmounts.map((preset) => (
                <button
                  key={preset}
                  onClick={() => setAmount(preset)}
                  className={`rounded-xl border p-3 text-center transition-colors ${
                    amount === preset
                      ? "border-lav-600 bg-lav-50 text-lav-700"
                      : "border-line bg-white text-ink hover:bg-cream"
                  }`}
                >
                  <span className="text-[0.9rem] font-semibold">{formatNaira(preset)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Custom Amount */}
          <div>
            <label className="block text-[0.86rem] font-medium text-ink mb-2">
              Custom Amount (₦1,000 - ₦500,000)
            </label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              min={1000}
              max={500000}
              className="w-full rounded-xl border border-line bg-white px-4 py-3 text-[0.95rem] text-ink outline-none transition-colors focus:border-lav-600"
            />
          </div>

          <p className={`rounded-xl border p-3 text-sm ${preview ? "border-lav-200 bg-lav-50 text-lav-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
            {preview ? "Create and redeem a fictional gift card with demo funds. You can redeem it in this same demo account." : "Gift card codes are bearer secrets: anyone with the code can redeem it. Email and message are labels only; no email is sent and the recipient is not restricted. Share the code privately yourself."}
          </p>

          {!preview && <>
          {/* Recipient Email */}
          <div>
            <label className="block text-[0.86rem] font-medium text-ink mb-2">
              Recipient Email (optional)
            </label>
            <input
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="friend@example.com"
              className="w-full rounded-xl border border-line bg-white px-4 py-3 text-[0.95rem] text-ink outline-none transition-colors focus:border-lav-600"
            />
          </div>

          {/* Message */}
          <div>
            <label className="block text-[0.86rem] font-medium text-ink mb-2">
              Personal Message (optional)
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Happy birthday! Use this to buy your next virtual number."
              rows={3}
              className="w-full rounded-xl border border-line bg-white px-4 py-3 text-[0.95rem] text-ink outline-none transition-colors focus:border-lav-600"
            />
          </div>

          </>}
          {/* Wallet Balance */}
          <div className="rounded-xl border border-line bg-cream p-4">
            <p className="text-[0.86rem] text-ink-2">Wallet Balance</p>
            <p className="text-[1.5rem] font-bold text-ink">
              {formatNaira(user.walletBalance)}
            </p>
          </div>

          {/* Messages */}
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[0.9rem] text-red-700">
              {error}
            </div>
          )}

          {success && (
            <div className="demo-arrive rounded-xl border border-green-200 bg-green-50 p-6 text-center">
              <Gift className="mx-auto h-12 w-12 text-green-600 mb-3" />
              <p className="text-[1.1rem] font-semibold text-green-700 mb-2">
                {preview ? "Demo gift card created!" : "Gift Card Created!"}
              </p>
              <p className="text-[0.9rem] text-green-600 mb-4">
                {preview ? "Try this fictional code in the Redeem tab. No real money or email is sent." : "Copy and share this code privately. No email is sent automatically."}
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
              <button type="button" onClick={() => setSuccess(null)} className="mt-3 text-sm font-semibold underline">Create another card</button>
            </div>
          )}

          {/* Create Button */}
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
            <div className="demo-arrive rounded-xl border border-green-200 bg-green-50 p-6 text-center">
              <Check className="mx-auto h-12 w-12 text-green-600 mb-3" />
              <p className="text-[1.1rem] font-semibold text-green-700 mb-2">
                {preview ? "Demo gift card redeemed!" : "Gift Card Redeemed!"}
              </p>
              <p className="text-[1.5rem] font-bold text-green-600">
                {formatNaira(redeemSuccess)}
              </p>
              <p className="mt-2 text-[0.86rem] text-green-600">
                Added to your wallet balance
              </p>
              <button type="button" onClick={() => setRedeemSuccess(null)} className="mt-3 text-sm font-semibold underline">Redeem another card</button>
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
              <button type="button" className="ml-2 font-semibold underline" onClick={() => { setHistoryState("loading"); setHistoryReload((value) => value + 1); }}>Retry</button>
            </div>
          ) : cards.length === 0 ? (
            <div className="rounded-xl border border-line bg-white p-8 text-center">
              <Gift className="mx-auto h-12 w-12 text-ink-3 mb-3" />
              <p className="text-[0.95rem] text-ink-2">
                No gift cards purchased yet
              </p>
            </div>
          ) : (
            cards.map((card) => (
              <div
                key={card.id}
                className="rounded-xl border border-line bg-white p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <code className="text-[0.95rem] font-bold text-ink">
                        {card.code}
                      </code>
                      <button
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
                    <p className="text-[0.86rem] text-ink-2">
                      {formatNaira(card.amount)} · {new Date(card.createdAt).toLocaleDateString()}
                    </p>
                    {card.recipientEmail && (
                      <p className="text-[0.82rem] text-ink-3 mt-1">
                        To: {card.recipientEmail}
                      </p>
                    )}
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-[0.75rem] font-semibold ${
                      card.status === "active"
                        ? "bg-emerald-50 text-emerald-700"
                        : card.status === "redeemed"
                          ? "bg-lav-100 text-lav-700"
                          : "bg-ink/5 text-ink-2"
                    }`}
                  >
                    {card.status.charAt(0).toUpperCase() + card.status.slice(1)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
    </>
  );
}
