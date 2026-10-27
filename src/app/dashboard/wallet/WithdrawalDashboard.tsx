"use client";

import { useState, useEffect } from "react";
import { formatNaira } from "@/lib/catalog";
import { useToast } from "@/components/ui/Toast";
import { EmptyState } from "@/components/dashboard/EmptyState";
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
};

const statusLabels: Record<string, string> = {
  pending: "Awaiting approval",
  processing: "On its way",
  completed: "Paid out",
  failed: "Failed",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[0.64rem] font-semibold ${
        statusStyles[status] ?? "bg-lav-50 text-lav-700"
      }`}
    >
      {statusLabels[status] ?? status}
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
export function WithdrawalDashboard({ balance }: { balance: number }) {
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState<Tab>("withdraw");
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const [amount, setAmount] = useState("");
  const [selectedBankAccountId, setSelectedBankAccountId] = useState("");

  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [verifyingAccount, setVerifyingAccount] = useState(false);

  useEffect(() => {
    fetchBankAccounts();
    fetchWithdrawalHistory();
    fetchBanks();
  }, []);

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
    try {
      const response = await fetch("/api/wallet/withdraw/history");
      const data = await response.json();
      if (data.ok) setWithdrawals(data.withdrawals);
    } catch (error) {
      console.error("Failed to fetch withdrawal history:", error);
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

    try {
      const response = await fetch("/api/wallet/verify-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bankCode, accountNumber }),
      });
      const data = await response.json();

      if (data.ok) {
        setAccountName(data.accountName);
        addToast({ type: "success", message: "Account verified" });
      } else {
        addToast({ type: "error", message: data.error || "Failed to verify account" });
      }
    } catch {
      addToast({ type: "error", message: "Failed to verify account" });
    } finally {
      setVerifyingAccount(false);
    }
  }

  async function addBankAccount() {
    if (!bankCode || !accountNumber || !accountName) {
      addToast({ type: "error", message: "Please complete all fields" });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/wallet/bank-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bankCode,
          accountNumber,
          setDefault: bankAccounts.length === 0,
        }),
      });
      const data = await response.json();

      if (data.ok) {
        addToast({ type: "success", message: "Bank account added" });
        setBankCode("");
        setAccountNumber("");
        setAccountName("");
        fetchBankAccounts();
      } else {
        addToast({ type: "error", message: data.error || "Failed to add bank account" });
      }
    } catch {
      addToast({ type: "error", message: "Failed to add bank account" });
    } finally {
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

  async function requestWithdrawal() {
    const withdrawAmount = parseFloat(amount);

    if (!withdrawAmount || withdrawAmount < 1000) {
      addToast({ type: "error", message: "Minimum withdrawal amount is ₦1,000" });
      return;
    }
    if (withdrawAmount > balance) {
      addToast({ type: "error", message: "That's more than your available balance" });
      return;
    }
    if (!selectedBankAccountId) {
      addToast({ type: "error", message: "Choose a bank account first" });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/wallet/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: withdrawAmount, bankAccountId: selectedBankAccountId }),
      });
      const data = await response.json();

      if (data.ok) {
        addToast({ type: "success", message: "Withdrawal requested — we'll approve it shortly" });
        setAmount("");
        setSelectedBankAccountId("");
        fetchWithdrawalHistory();
        setActiveTab("history");
      } else {
        addToast({ type: "error", message: data.error || "Failed to process withdrawal" });
      }
    } catch {
      addToast({ type: "error", message: "Failed to process withdrawal" });
    } finally {
      setLoading(false);
    }
  }

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
            Requests are reviewed, then paid out through Paystack Transfers.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/70 px-2.5 py-1 text-[0.68rem] text-ink-3">
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
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[0.76rem] font-semibold transition-colors ${
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
              body="Payouts need a verified Nigerian bank account in your own name. It takes one step."
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
                    min="1000"
                    max={balance}
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
                      onClick={() => setAmount(String(Math.min(preset, balance)))}
                      disabled={balance < preset}
                      className="rounded-full border border-line bg-white px-2.5 py-1 text-[0.68rem] font-semibold text-ink-2 hover:border-lav-200 disabled:opacity-40"
                    >
                      {formatNaira(preset)}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setAmount(String(balance))}
                    className="rounded-full bg-lav-50 px-2.5 py-1 text-[0.68rem] font-semibold text-lav-800"
                  >
                    All {formatNaira(balance)}
                  </button>
                </div>
                <p className="mt-1.5 text-[0.7rem] text-ink-3">
                  Minimum ₦1,000 · paid in Naira to the account you choose
                </p>
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

              <button
                type="button"
                onClick={requestWithdrawal}
                disabled={loading || !amount || !selectedBankAccountId}
                className="btn btn-primary w-full !py-3 !text-[0.82rem] disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Requesting…
                  </>
                ) : (
                  <>
                    <ArrowUpRight className="h-4 w-4" /> Request withdrawal
                  </>
                )}
              </button>

              <p className="flex items-start gap-2 rounded-xl bg-lav-50 px-3 py-2.5 text-[0.74rem] leading-relaxed text-lav-800">
                <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Approved payouts usually land within one working day. If a payout fails, the
                amount returns to your wallet automatically.
              </p>
            </div>
          )}
        </div>
      )}

      {activeTab === "history" && (
        <div className="rounded-[1.5rem] border border-line bg-[#fffdfa] p-5">
          {withdrawals.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="No withdrawal requests yet"
              body="Once you request a payout it appears here with its reference and status."
              action={{ label: "Request a withdrawal", href: "#withdraw" }}
              className="!border-0 !bg-transparent !py-6"
            />
          ) : (
            <div className="grid gap-2">
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
                      <p className="truncate text-[0.72rem] text-ink-2">
                        {withdrawal.bankName} · {withdrawal.accountNumber}
                      </p>
                    </div>
                    <StatusPill status={withdrawal.status} />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.66rem] text-ink-3">
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
                    <p className="mt-1.5 flex items-start gap-1.5 text-[0.7rem] text-rose-600">
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
            <p className="mt-0.5 text-[0.76rem] text-ink-2">
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
                  onChange={(event) => {
                    setBankCode(event.target.value);
                    setAccountName("");
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
                    onChange={(event) => {
                      setAccountNumber(event.target.value.replace(/\D/g, "").slice(0, 10));
                      setAccountName("");
                    }}
                    maxLength={10}
                    className="field"
                  />
                  <button
                    type="button"
                    onClick={verifyAccount}
                    disabled={verifyingAccount || !bankCode || accountNumber.length !== 10}
                    className="btn shrink-0 border border-line bg-white !px-3.5 !py-2.5 !text-[0.78rem] text-ink hover:border-lav-200 disabled:opacity-50"
                  >
                    {verifyingAccount ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Verify"}
                  </button>
                </div>
              </div>

              {accountName && (
                <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[0.78rem] font-medium text-emerald-800">
                  <Check className="h-3.5 w-3.5" /> {accountName}
                </p>
              )}

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
                          <span className="rounded-full bg-lav-50 px-2 py-0.5 text-[0.6rem] font-semibold text-lav-700">
                            Default
                          </span>
                        )}
                      </p>
                      <p className="truncate text-[0.72rem] text-ink-2">{account.accountNumber}</p>
                      <p className="truncate text-[0.72rem] text-ink-3">{account.accountName}</p>
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
    </section>
  );
}
