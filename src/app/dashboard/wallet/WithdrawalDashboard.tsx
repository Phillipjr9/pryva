"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { formatNaira } from "@/lib/catalog";
import { MAX_WITHDRAWAL, MIN_WITHDRAWAL, maxWithdrawalForBalance, withdrawalFee } from "@/lib/withdrawal";
import { clearTrackedWithdrawalIntent, readWithdrawalIntents, saveTrackedWithdrawalIntent, type WithdrawalIntent } from "@/lib/withdrawal-intent";
import { parseWithdrawalReceipt, type WithdrawalSubmitResult } from "@/lib/withdrawal-receipt";
import { useToast } from "@/components/ui/Toast";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { WithdrawalReviewDialog, type WithdrawalReview } from "@/components/dashboard/WithdrawalReviewDialog";
import {
  AlertCircle,
  ArrowUpRight,
  Card,
  Check,
  Loader2,
  Plus,
  Receipt,
  Shield,
  Trash2,
  Wallet,
} from "@/components/icons";

interface BankAccount {
  id: string;
  bankName: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  isDefault: boolean;
}

interface Withdrawal {
  id: string;
  reference: string;
  amount: number;
  fee: number;
  bankName: string;
  accountNumber: string;
  accountName: string;
  status: string;
  failureReason?: string;
  createdAt: string;
  processedAt?: string;
  completedAt?: string;
}

interface Bank {
  name: string;
  code: string;
}

type Tab = "withdraw" | "history" | "accounts";

const statusStyles: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  processing: "bg-lav-50 text-lav-700",
  completed: "bg-emerald-50 text-emerald-700",
  failed: "bg-rose-50 text-rose-700",
  rejected: "bg-rose-50 text-rose-700",
};

const statusLabels: Record<string, string> = {
  pending: "Awaiting approval",
  processing: "Processing / review",
  completed: "Paid out",
  failed: "Failed",
  rejected: "Rejected",
};

function StatusPill({ status, testMode }: { status: string; testMode: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-micro font-semibold ${
        statusStyles[status] ?? "bg-lav-50 text-lav-700"
      }`}
    >
      {testMode && status === "completed" ? "Test complete" : statusLabels[status] ?? status}
    </span>
  );
}

/**
 * Money leaving the wallet.
 *
 * Previously this rendered its own purple gradient balance card, gray tabs and
 * default form controls — a different design system from the rest of the
 * dashboard, and a second, independently-fetched copy of a balance the page
 * already shows. Now it uses the shell's cards, one set of controls and the
 * wallet page's balance, which it receives as a prop.
 */
export function WithdrawalDashboard({ balance, userId, testMode = false }: { balance: number; userId: string; testMode?: boolean }) {
  const { addToast } = useToast();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("withdraw");
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [historyState, setHistoryState] = useState<"loading" | "ready" | "error">("loading");
  const [pendingIntents, setPendingIntents] = useState<WithdrawalIntent[]>([]);
  const [review, setReview] = useState<WithdrawalReview | null>(null);
  const [recoveryState, setRecoveryState] = useState<"loading" | "ready" | "unavailable">("loading");
  const intentKey = `pryva.withdrawal.pending.v1.${userId}`;
  const sending = useRef(false);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [amount, setAmount] = useState("");
  const [selectedBankAccountId, setSelectedBankAccountId] = useState("");

  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [verifyingAccount, setVerifyingAccount] = useState(false);
  // A toast disappears in a few seconds; a disabled Save button does not. Without
  // this the only trace of why verification failed was gone before the user
  // looked back at the form, which reads as a broken button.
  const [verifyError, setVerifyError] = useState<string | null>(null);

  useEffect(() => {
    fetchBankAccounts();
    fetchWithdrawalHistory();
    fetchBanks();
  }, []);

  useEffect(() => {
    function restore() {
      try {
        setPendingIntents(readWithdrawalIntents(window.localStorage, intentKey));
        setRecoveryState("ready");
      } catch {
        // Without durable, readable recovery state we cannot safely start a new
        // request: its response could be lost and repeated after a reload.
        setRecoveryState("unavailable");
      }
    }
    restore();
    const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === intentKey || event.key.startsWith(`${intentKey}.`)) restore(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [intentKey]);

  async function fetchBankAccounts() {
    try {
      const response = await fetch("/api/wallet/bank-accounts");
      const data = await response.json();
      if (data.ok) setBankAccounts(data.bankAccounts);
    } catch (error) {
      console.error("Failed to fetch bank accounts:", error);
    } finally {
      setLoaded(true);
    }
  }

  async function fetchWithdrawalHistory() {
    setHistoryState("loading");
    try {
      const response = await fetch("/api/wallet/withdraw/history", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok || !Array.isArray(data.withdrawals)) throw new Error("History unavailable");
      setWithdrawals(data.withdrawals);
      setHistoryState("ready");
    } catch {
      setHistoryState("error");
    }
  }

  async function fetchBanks() {
    try {
      const response = await fetch("/api/wallet/banks");
      const data = await response.json();
      if (data.ok) setBanks(data.banks);
    } catch (error) {
      console.error("Failed to fetch banks:", error);
    }
  }

  async function verifyAccount() {
    if (!bankCode || !accountNumber || accountNumber.length !== 10) {
      addToast({ type: "error", message: "Please enter a valid bank and 10-digit account number" });
      return;
    }

    setVerifyingAccount(true);
    setAccountName("");
    setVerifyError(null);
    const abort = new AbortController();
    const timeout = window.setTimeout(() => abort.abort(), 20_000);

    try {
      const response = await fetch("/api/wallet/verify-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankCode, accountNumber }),
        signal: abort.signal,
      });
      const data = await response.json();

      if (response.ok && data.ok === true && typeof data.accountName === "string" && data.accountName.trim()) {
        setAccountName(data.accountName);
        addToast({ type: "success", message: "Account verified" });
      } else {
        const message = typeof data.error === "string" && data.error.trim()
          ? data.error
          : "Failed to verify account";
        setVerifyError(message);
        addToast({ type: "error", message });
      }
    } catch {
      const message = "Could not reach bank verification. Check the details and try again.";
      setVerifyError(message);
      addToast({ type: "error", message });
    } finally {
      window.clearTimeout(timeout);
      setVerifyingAccount(false);
    }
  }

  async function addBankAccount() {
    if (!bankCode || !accountNumber || !accountName) {
      addToast({ type: "error", message: "Please complete all fields" });
      return;
    }

    setLoading(true);
    const abort = new AbortController();
    const timeout = window.setTimeout(() => abort.abort(), 20_000);
    try {
      const response = await fetch("/api/wallet/bank-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankCode,
          accountNumber,
          expectedAccountName: accountName,
          setDefault: bankAccounts.length === 0,
        }),
        signal: abort.signal,
      });
      const data = await response.json();

      if (response.ok && data.ok) {
        addToast({ type: "success", message: "Bank account added" });
        setBankCode("");
        setAccountNumber("");
        setAccountName("");
        fetchBankAccounts();
      } else {
        if (response.status === 409) setAccountName("");
        addToast({ type: "error", message: data.error || "Failed to add bank account" });
      }
    } catch {
      addToast({ type: "error", message: "Failed to add bank account" });
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }

  async function deleteBankAccount(accountId: string) {
    if (!confirm("Remove this bank account? Payouts already in progress are not affected.")) {
      return;
    }

    try {
      const response = await fetch(`/api/wallet/bank-accounts?id=${accountId}`, { method: "DELETE" });
      const data = await response.json();

      if (data.ok) {
        addToast({ type: "success", message: "Bank account removed" });
        if (selectedBankAccountId === accountId) setSelectedBankAccountId("");
        fetchBankAccounts();
      } else {
        addToast({ type: "error", message: data.error || "Failed to remove bank account" });
      }
    } catch {
      addToast({ type: "error", message: "Failed to remove bank account" });
    }
  }

  async function sendWithdrawalIntent(intent: WithdrawalIntent): Promise<WithdrawalSubmitResult> {
    if (sending.current) return { ok: false, message: "A request is already being checked. Review Requests before trying again." };
    sending.current = true;
    setLoading(true);
    const abort = new AbortController();
    const timeout = window.setTimeout(() => abort.abort(), 20_000);
    try {
      const response = await fetch("/api/wallet/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(intent),
        signal: abort.signal,
      });
      const data: unknown = await response.json();
      const receipt = response.ok ? parseWithdrawalReceipt(data, intent) : null;
      if (receipt) {
        try {
          clearTrackedWithdrawalIntent(window.localStorage, intentKey, intent.requestId);
          setPendingIntents(readWithdrawalIntents(window.localStorage, intentKey));
        } catch {
          setRecoveryState("unavailable");
        }
        addToast({ type: "success", message: receipt.replayed ? "Existing withdrawal request found" : "Withdrawal request submitted for review" });
        setAmount("");
        setSelectedBankAccountId("");
        setActiveTab("history");
        void fetchWithdrawalHistory();
        router.refresh();
        return { ok: true, receipt };
      }
      // A later error can follow an earlier lost response. Retain the original
      // key even for a 4xx until the request is reviewed or reconciled.
      const error = data && typeof data === "object" && !Array.isArray(data) && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error.slice(0, 240) : "The request response could not be confirmed.";
      const message = `${error} Review requests or retry the original request before starting another.`;
      setActiveTab("history");
      void fetchWithdrawalHistory();
      router.refresh();
      addToast({ type: "error", message });
      return { ok: false, message };
    } catch {
      const message = "Withdrawal outcome is unconfirmed. Review requests or retry the original request before starting another.";
      setActiveTab("history");
      void fetchWithdrawalHistory();
      router.refresh();
      addToast({ type: "error", message });
      return { ok: false, message };
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
      sending.current = false;
    }
  }

  function openWithdrawalReview() {
    const withdrawAmount = Number(amount);
    if (!Number.isSafeInteger(withdrawAmount) || withdrawAmount < MIN_WITHDRAWAL || withdrawAmount > MAX_WITHDRAWAL) {
      addToast({ type: "error", message: "Enter a whole-naira amount between ₦1,000 and ₦5,000,000" });
      return;
    }
    const fee = withdrawalFee(withdrawAmount);
    if (withdrawAmount + fee > balance) {
      addToast({ type: "error", message: "The amount plus fee exceeds your available balance" });
      return;
    }
    const account = bankAccounts.find((value) => value.id === selectedBankAccountId);
    if (!account) { addToast({ type: "error", message: "Choose a bank account first" }); return; }
    setReview({ amount: withdrawAmount, fee, bankAccountId: account.id, bankName: account.bankName, accountNumber: account.accountNumber, accountName: account.accountName });
  }

  async function requestWithdrawal(details: WithdrawalReview): Promise<WithdrawalSubmitResult> {
    if (sending.current || recoveryState !== "ready") return { ok: false, message: "Withdrawal recovery is unavailable. Review Requests before trying again." };
    if (!Number.isSafeInteger(details.amount) || details.amount < MIN_WITHDRAWAL || details.amount > MAX_WITHDRAWAL ||
        details.fee !== withdrawalFee(details.amount) || details.amount + details.fee > balance || !bankAccounts.some((account) => account.id === details.bankAccountId)) {
      setActiveTab("history");
      return { ok: false, message: "The withdrawal details are no longer valid. Check your balance and bank account before trying again." };
    }
    try {
      const existing = readWithdrawalIntents(window.localStorage, intentKey);
      if (existing.length) {
        setPendingIntents(existing);
        setActiveTab("history");
        return { ok: false, message: "Resolve your previous request before starting a new one." };
      }
      const intent: WithdrawalIntent = { requestId: crypto.randomUUID(), amount: details.amount, bankAccountId: details.bankAccountId };
      // Save before the request leaves the browser; separate keys prevent one
      // tab from overwriting another tab's uncertain request.
      saveTrackedWithdrawalIntent(window.localStorage, intentKey, intent);
      setPendingIntents(readWithdrawalIntents(window.localStorage, intentKey));
      return await sendWithdrawalIntent(intent);
    } catch {
      setRecoveryState("unavailable");
      setActiveTab("history");
      return { ok: false, message: "Withdrawal recovery storage is unavailable. Check your requests or contact support before trying again." };
    }
  }

  function abandonIntent(intent: WithdrawalIntent) {
    if (historyState !== "ready" || loading) return;
    if (!confirm("Only clear this recovery record after checking your withdrawal history and, if needed, confirming with support that the original request is not still in flight. Clearing it does not cancel a submitted withdrawal. Continue?")) return;
    try {
      clearTrackedWithdrawalIntent(window.localStorage, intentKey, intent.requestId);
      const remaining = readWithdrawalIntents(window.localStorage, intentKey);
      setPendingIntents(remaining);
      if (!remaining.length) setActiveTab("withdraw");
    } catch {
      setRecoveryState("unavailable");
      addToast({ type: "error", message: "Could not clear the recovery record. Contact support." });
    }
  }

  const maxPayout = maxWithdrawalForBalance(balance);
  const enteredAmount = Number(amount);
  const validEnteredAmount = Number.isSafeInteger(enteredAmount) && enteredAmount >= MIN_WITHDRAWAL && enteredAmount <= MAX_WITHDRAWAL;
  const fee = validEnteredAmount ? withdrawalFee(enteredAmount) : 0;

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: "withdraw", label: "Withdraw" },
    { key: "history", label: `Requests${withdrawals.length ? ` (${withdrawals.length})` : ""}` },
    { key: "accounts", label: `Bank accounts${bankAccounts.length ? ` (${bankAccounts.length})` : ""}` },
  ];

  return (
    <section id="withdraw" className="grid gap-3 scroll-mt-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[1.05rem] font-semibold">Withdraw to your bank</h2>
          <p className="mt-0.5 text-[0.8rem] text-ink-2">
            {testMode ? "Test requests are reviewed; Paystack test transfers do not make real payouts." : "Requests are reviewed, then paid out through Paystack Transfers."}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/70 px-2.5 py-1 text-micro text-ink-3">
          <Wallet className="h-3 w-3 text-lav-600" /> {formatNaira(balance)} available
        </span>
      </div>

      <div className="flex gap-1.5 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            aria-pressed={activeTab === tab.key}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-meta font-semibold transition-colors ${
              activeTab === tab.key
                ? "border-ink bg-ink text-white"
                : "border-line bg-white/70 text-ink-2 hover:border-lav-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "withdraw" && (
        <div className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
          {bankAccounts.length === 0 ? (
            <EmptyState
              icon={Card}
              title="Add a bank account first"
              body="Add a Nigerian bank account and check the resolved account name carefully before requesting a payout."
              action={{ label: "Add a bank account", href: "#bank-accounts" }}
              className="!border-0 !bg-transparent !py-6"
            />
          ) : (
            <div className="grid gap-3.5">
              <div>
                <label htmlFor="withdraw-amount" className="field-label">
                  Amount to withdraw
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[0.9rem] text-ink-3">
                    ₦
                  </span>
                  <input
                    id="withdraw-amount"
                    type="number"
                    inputMode="numeric"
                    min={MIN_WITHDRAWAL}
                    max={maxPayout}
                    step="1"
                    placeholder="0"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    className="field !pl-8"
                  />
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {[5000, 10000, 25000].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setAmount(String(preset))}
                      disabled={preset > maxPayout}
                      className="rounded-full border border-line bg-white px-2.5 py-1 text-micro font-semibold text-ink-2 hover:border-lav-200 disabled:opacity-40"
                    >
                      {formatNaira(preset)}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setAmount(String(maxPayout))}
                    disabled={maxPayout < MIN_WITHDRAWAL}
                    className="rounded-full bg-lav-50 px-2.5 py-1 text-micro font-semibold text-lav-800 disabled:opacity-40"
                  >
                    Maximum payout {formatNaira(maxPayout)}
                  </button>
                </div>
                <p className="mt-1.5 text-meta text-ink-3">
                  Minimum ₦1,000 · a 1% fee applies above ₦5,000 and is deducted in addition to the payout.
                </p>
                {validEnteredAmount && (
                  <p className="mt-1 text-meta text-ink-2">
                    Bank payout {formatNaira(enteredAmount)} · Fee {formatNaira(fee)} · Wallet deduction {formatNaira(enteredAmount + fee)}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="withdraw-bank" className="field-label">
                  Pay out to
                </label>
                <select
                  id="withdraw-bank"
                  value={selectedBankAccountId}
                  onChange={(event) => setSelectedBankAccountId(event.target.value)}
                  className="field"
                >
                  <option value="">Choose a bank account</option>
                  {bankAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.bankName} · {account.accountNumber} ({account.accountName})
                    </option>
                  ))}
                </select>
              </div>

              {recoveryState === "unavailable" && <p role="alert" className="text-sm text-rose-700">Withdrawal recovery storage is unavailable or unreadable. Contact support before starting a new request.</p>}
              {pendingIntents.length > 0 && <p role="alert" className="text-sm text-rose-700">Your previous request needs attention. Open the Requests tab to retry the original request or review it with support.</p>}
              <button
                type="button"
                onClick={openWithdrawalReview}
                disabled={loading || recoveryState !== "ready" || pendingIntents.length > 0 || !amount || !selectedBankAccountId}
                className="btn btn-primary w-full !py-3 !text-[0.82rem] disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Requesting…
                  </>
                ) : (
                  <>
                    <ArrowUpRight className="h-4 w-4" /> Review withdrawal
                  </>
                )}
              </button>

              <p className="flex items-start gap-2 rounded-xl bg-lav-50 px-3 py-2.5 text-meta leading-relaxed text-lav-800">
                <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Requests are reviewed. An initiated transfer is not confirmation of settlement; uncertain outcomes require manual reconciliation.
              </p>
            </div>
          )}
        </div>
      )}

      {activeTab === "history" && (
        <div className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
          {pendingIntents.map((intent) => (
            <div key={intent.requestId} role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              Your {formatNaira(intent.amount)} request may already be recorded. Request ID: {intent.requestId}. Retrying uses this same ID and will not create a second withdrawal for it. If the original was never recorded, retrying may submit it.
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                <button type="button" disabled={loading || recoveryState !== "ready"} className="font-semibold underline disabled:opacity-50" onClick={() => void sendWithdrawalIntent(intent)}>Retry original request</button>
                {historyState === "ready" && <button type="button" disabled={loading} className="font-semibold underline disabled:opacity-50" onClick={() => abandonIntent(intent)}>Clear after reconciliation</button>}
              </div>
            </div>
          ))}
          {historyState === "loading" ? (
            <p className="text-sm text-ink-2">Loading withdrawal requests…</p>
          ) : historyState === "error" ? (
            <div role="alert" className="text-sm text-rose-700">Requests could not be loaded. <button type="button" className="font-semibold underline" onClick={() => void fetchWithdrawalHistory()}>Retry</button></div>
          ) : withdrawals.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="No withdrawal requests yet"
              body="Once you request a payout it appears here with its reference and status."
              action={{ label: "Request a withdrawal", href: "#withdraw" }}
              className="!border-0 !bg-transparent !py-6"
            />
          ) : (
            <div className="grid gap-2">
              <p className="text-xs text-ink-3">Showing the 20 most recent requests.</p>
              {withdrawals.map((withdrawal) => (
                <div
                  key={withdrawal.id}
                  className="rounded-xl border border-line bg-white px-3.5 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[0.9rem] font-semibold text-ink">
                        {formatNaira(withdrawal.amount)}
                      </p>
                      <p className="truncate text-meta text-ink-2">
                        {withdrawal.bankName} · {withdrawal.accountNumber}
                      </p>
                    </div>
                    <StatusPill status={withdrawal.status} testMode={testMode} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-micro text-ink-3">
                    <span>Ref {withdrawal.reference}</span>
                    {withdrawal.fee > 0 && <span>Fee {formatNaira(withdrawal.fee)}</span>}
                    <span>
                      {new Date(withdrawal.createdAt).toLocaleDateString("en-NG", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                  {withdrawal.failureReason && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-meta text-rose-600">
                      <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                      {withdrawal.failureReason}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "accounts" && (
        <div id="bank-accounts" className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
            <p className="text-[0.95rem] font-semibold">Add a bank account</p>
            <p className="mt-0.5 text-meta text-ink-2">
              We verify the name on the account before saving it.
            </p>

            <div className="mt-3.5 grid gap-3">
              <div>
                <label htmlFor="bank" className="field-label">
                  Bank
                </label>
                <select
                  id="bank"
                  value={bankCode}
                  disabled={verifyingAccount || loading}
                  onChange={(event) => {
                    setBankCode(event.target.value);
                    setAccountName("");
                    setVerifyError(null);
                  }}
                  className="field"
                >
                  <option value="">Choose a bank</option>
                  {banks.map((bank) => (
                    <option key={bank.code} value={bank.code}>
                      {bank.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="account-number" className="field-label">
                  Account number
                </label>
                <div className="flex gap-2">
                  <input
                    id="account-number"
                    type="text"
                    inputMode="numeric"
                    placeholder="10 digits"
                    value={accountNumber}
                    disabled={verifyingAccount || loading}
                    onChange={(event) => {
                      setAccountNumber(event.target.value.replace(/\D/g, "").slice(0, 10));
                      setAccountName("");
                      setVerifyError(null);
                    }}
                    maxLength={10}
                    className="field"
                  />
                  <button
                    type="button"
                    onClick={verifyAccount}
                    disabled={verifyingAccount || loading || !bankCode || accountNumber.length !== 10}
                    className="btn shrink-0 border border-line bg-white !px-3.5 !py-2.5 !text-[0.8125rem] sm:!text-[0.78rem] text-ink hover:border-lav-200 disabled:opacity-50"
                  >
                    {verifyingAccount ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Verify"}
                  </button>
                </div>
              </div>

              {accountName && (
                <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-meta font-medium text-emerald-800">
                  <Check className="h-3.5 w-3.5" /> {accountName}
                </p>
              )}

              {!accountName && verifyError && (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-meta leading-relaxed text-rose-700">
                  {verifyError}
                </p>
              )}

              {!accountName && !verifyError && (
                <p className="text-meta leading-relaxed text-ink-3">
                  Saving unlocks once the account is verified. The name shown comes from the bank,
                  not from anything you type, so a payout can only go to the account it was resolved
                  against.
                </p>
              )}

              {/* Stated up front rather than discovered as an error: this is the
                  rule the withdrawal API enforces, and a customer adding somebody
                  else's account should find out before they have filled in a
                  withdrawal and been refused. */}
              <p className="flex gap-2 rounded-xl border border-lav-200 bg-lav-50 px-3 py-2.5 text-meta leading-relaxed text-ink-2">
                <Shield className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>
                  Withdrawals are paid only to a bank account in the same name as the one that
                  funded your wallet. Money is never sent to a third-party account, so an account
                  in somebody else&apos;s name cannot be used.
                </span>
              </p>

              <button
                type="button"
                onClick={addBankAccount}
                disabled={loading || !bankCode || !accountNumber || !accountName}
                className="btn btn-primary w-full !py-2.5 !text-[0.8rem] disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" /> Save bank account
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
            <p className="text-[0.95rem] font-semibold">Saved accounts</p>
            {!loaded ? (
              <p className="mt-3 text-[0.8rem] text-ink-3">Loading…</p>
            ) : bankAccounts.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-line bg-cream/50 px-4 py-5 text-center text-[0.8rem] text-ink-3">
                Nothing saved yet. Add one and it can be used for every payout.
              </p>
            ) : (
              <div className="mt-3 grid gap-2">
                {bankAccounts.map((account) => (
                  <div
                    key={account.id}
                    className="flex items-start justify-between gap-3 rounded-xl border border-line bg-white px-3.5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-[0.84rem] font-semibold text-ink">
                        {account.bankName}
                        {account.isDefault && (
                          <span className="rounded-full bg-lav-50 px-2 py-0.5 text-micro font-semibold text-lav-700">
                            Default
                          </span>
                        )}
                      </p>
                      <p className="truncate text-meta text-ink-2">{account.accountNumber}</p>
                      <p className="truncate text-meta text-ink-3">{account.accountName}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteBankAccount(account.id)}
                      aria-label={`Remove ${account.bankName} account`}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-3 transition-colors hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {review && <WithdrawalReviewDialog review={review} onSubmit={requestWithdrawal} onClose={() => setReview(null)} testMode={testMode} />}
    </section>
  );
}
