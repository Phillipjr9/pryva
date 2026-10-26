"use client";

import { useState, useEffect } from "react";
import { formatNaira } from "@/lib/catalog";
import { Gift, Copy, Check } from "@/components/icons";
import { PaymentSuccess } from "@/components/ui/PaymentSuccess";
import { PaymentLoading } from "@/components/ui/PaymentLoading";
import type { User, GiftCard } from "@/db/schema";

interface GiftCardsManagerProps {
  user: User;
}

type Tab = "create" | "redeem" | "history";

export function GiftCardsManager({ user }: GiftCardsManagerProps) {
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
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab === "history") {
      fetchHistory();
    }
  }, [activeTab]);

  async function fetchHistory() {
    try {
      const response = await fetch("/api/gift-cards/history");
      const data = await response.json();
      if (data.ok) {
        setCards(data.cards);
      }
    } catch (err) {
      console.error("Failed to fetch history:", err);
    }
  }

  async function handleCreate() {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/gift-cards/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, recipientEmail: recipientEmail || undefined, message: message || undefined }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Purchase failed");
      }

      setSuccess({ code: data.code, amount: data.amount });
      setAmount(5000);
      setRecipientEmail("");
      setMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Purchase failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleRedeem() {
    setRedeemLoading(true);
    setError(null);
    setRedeemSuccess(null);

    try {
      const response = await fetch("/api/gift-cards/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: redeemCode }),
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || "Redemption failed");
      }

      setRedeemSuccess(data.amount);
      setRedeemCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Redemption failed");
    } finally {
      setRedeemLoading(false);
    }
  }

  function copyCode(code: string) {
    navigator.clipboard.writeText(code);
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  }

  const presetAmounts = [2000, 5000, 10000, 25000, 50000];

  return (
    <>
      <PaymentLoading show={loading || redeemLoading} message="Processing your gift card..." />
      <PaymentSuccess
        show={!!success || !!redeemSuccess}
        title={success ? "Gift Card Created!" : "Gift Card Redeemed!"}
        message={success ? `Code: ${success.code}` : `${formatNaira(redeemSuccess || 0)} added to your wallet`}
        redirectUrl="/dashboard"
        redirectDelay={2500}
      />
      <div className="space-y-6">
        {/* Tabs */}
        <div className="flex gap-2 border-b border-line">
          {(["create", "redeem", "history"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
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
            <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
              <Gift className="mx-auto h-12 w-12 text-green-600 mb-3" />
              <p className="text-[1.1rem] font-semibold text-green-700 mb-2">
                Gift Card Created!
              </p>
              <p className="text-[0.9rem] text-green-600 mb-4">
                Share this code with the recipient:
              </p>
              <div className="flex items-center justify-center gap-2 rounded-xl bg-white p-4">
                <code className="text-[1.2rem] font-bold text-ink">
                  {success.code}
                </code>
                <button
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
            <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
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
          {cards.length === 0 ? (
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
                        ? "bg-green-100 text-green-700"
                        : card.status === "redeemed"
                        ? "bg-lav-100 text-lav-700"
                        : "bg-gray-100 text-gray-700"
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
