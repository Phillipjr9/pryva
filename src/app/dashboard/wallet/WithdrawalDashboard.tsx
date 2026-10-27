"use client";

import { useState, useEffect } from "react";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { toast } from "@/components/ui/Toast";
import { ArrowUpRight, Close, Loader2, Plus } from "@/components/icons";

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

export function WithdrawalDashboard() {
  const [activeTab, setActiveTab] = useState<"withdraw" | "history" | "accounts">("withdraw");
  const [balance, setBalance] = useState(0);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(false);

  // Withdrawal form state
  const [amount, setAmount] = useState("");
  const [selectedBankAccountId, setSelectedBankAccountId] = useState("");

  // Add bank account form state
  const [bankCode, setBankCode] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [verifyingAccount, setVerifyingAccount] = useState(false);

  useEffect(() => {
    fetchBalance();
    fetchBankAccounts();
    fetchWithdrawalHistory();
    fetchBanks();
  }, []);

  async function fetchBalance() {
    try {
      const response = await fetch("/api/user/profile");
      const data = await response.json();
      if (data.ok) {
        setBalance(data.user.walletBalance);
      }
    } catch (error) {
      console.error("Failed to fetch balance:", error);
    }
  }

  async function fetchBankAccounts() {
    try {
      const response = await fetch("/api/wallet/bank-accounts");
      const data = await response.json();
      if (data.ok) {
        setBankAccounts(data.bankAccounts);
      }
    } catch (error) {
      console.error("Failed to fetch bank accounts:", error);
    }
  }

  async function fetchWithdrawalHistory() {
    try {
      const response = await fetch("/api/wallet/withdraw/history");
      const data = await response.json();
      if (data.ok) {
        setWithdrawals(data.withdrawals);
      }
    } catch (error) {
      console.error("Failed to fetch withdrawal history:", error);
    }
  }

  async function fetchBanks() {
    try {
      const response = await fetch("/api/wallet/banks");
      const data = await response.json();
      if (data.ok) {
        setBanks(data.banks);
      }
    } catch (error) {
      console.error("Failed to fetch banks:", error);
    }
  }

  async function verifyAccount() {
    if (!bankCode || !accountNumber || accountNumber.length !== 10) {
      toast.error("Please enter a valid bank and 10-digit account number");
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
        toast.success("Account verified successfully");
      } else {
        toast.error(data.error || "Failed to verify account");
      }
    } catch (error) {
      toast.error("Failed to verify account");
    } finally {
      setVerifyingAccount(false);
    }
  }

  async function addBankAccount() {
    if (!bankCode || !accountNumber || !accountName) {
      toast.error("Please complete all fields");
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
        toast.success("Bank account added successfully");
        setBankCode("");
        setAccountNumber("");
        setAccountName("");
        fetchBankAccounts();
      } else {
        toast.error(data.error || "Failed to add bank account");
      }
    } catch (error) {
      toast.error("Failed to add bank account");
    } finally {
      setLoading(false);
    }
  }

  async function deleteBankAccount(accountId: string) {
    if (!confirm("Are you sure you want to delete this bank account?")) {
      return;
    }

    try {
      const response = await fetch(`/api/wallet/bank-accounts?id=${accountId}`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (data.ok) {
        toast.success("Bank account deleted");
        fetchBankAccounts();
      } else {
        toast.error(data.error || "Failed to delete bank account");
      }
    } catch (error) {
      toast.error("Failed to delete bank account");
    }
  }

  async function requestWithdrawal() {
    const withdrawAmount = parseFloat(amount);

    if (!withdrawAmount || withdrawAmount < 1000) {
      toast.error("Minimum withdrawal amount is ₦1,000");
      return;
    }

    if (withdrawAmount > balance) {
      toast.error("Insufficient balance");
      return;
    }

    if (!selectedBankAccountId) {
      toast.error("Please select a bank account");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch("/api/wallet/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: withdrawAmount,
          bankAccountId: selectedBankAccountId,
        }),
      });

      const data = await response.json();

      if (data.ok) {
        toast.success("Withdrawal request submitted successfully");
        setAmount("");
        setSelectedBankAccountId("");
        fetchBalance();
        fetchWithdrawalHistory();
        setActiveTab("history");
      } else {
        toast.error(data.error || "Failed to process withdrawal");
      }
    } catch (error) {
      toast.error("Failed to process withdrawal");
    } finally {
      setLoading(false);
    }
  }

  const getStatusBadge = (status: string) => {
    const styles = {
      pending: "bg-yellow-100 text-yellow-800",
      processing: "bg-blue-100 text-blue-800",
      completed: "bg-green-100 text-green-800",
      failed: "bg-red-100 text-red-800",
    };
    return styles[status as keyof typeof styles] || "bg-cream-2 text-gray-800";
  };

  return (
    <div className="space-y-6">
      {/* Balance Card */}
      <div className="bg-gradient-to-br from-purple-600 to-indigo-700 rounded-xl p-6 text-white">
        <p className="text-sm opacity-80">Available Balance</p>
        <p className="text-3xl font-bold mt-1">{formatCurrency(balance)}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-line">
        <button
          onClick={() => setActiveTab("withdraw")}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === "withdraw"
              ? "border-b-2 border-purple-600 text-purple-600"
              : "text-ink-2 hover:text-ink"
          }`}
        >
          Withdraw
        </button>
        <button
          onClick={() => setActiveTab("history")}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === "history"
              ? "border-b-2 border-purple-600 text-purple-600"
              : "text-ink-2 hover:text-ink"
          }`}
        >
          History
        </button>
        <button
          onClick={() => setActiveTab("accounts")}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === "accounts"
              ? "border-b-2 border-purple-600 text-purple-600"
              : "text-ink-2 hover:text-ink"
          }`}
        >
          Bank Accounts
        </button>
      </div>

      {/* Withdraw Tab */}
      {activeTab === "withdraw" && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink-2 mb-2">
              Amount
            </label>
            <Input
              type="number"
              placeholder="Enter amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="1000"
              max={balance}
            />
            <p className="text-xs text-ink-3 mt-1">
              Minimum: ₦1,000 • Fee: 1% for amounts above ₦5,000
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-2 mb-2">
              Bank Account
            </label>
            {bankAccounts.length === 0 ? (
              <div className="text-center py-8 bg-cream rounded-lg">
                <p className="text-ink-2 mb-4">No bank accounts added yet</p>
                <Button onClick={() => setActiveTab("accounts")}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Bank Account
                </Button>
              </div>
            ) : (
              <Select
                value={selectedBankAccountId}
                onChange={(e) => setSelectedBankAccountId(e.target.value)}
              >
                <option value="">Select bank account</option>
                {bankAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.bankName} - {account.accountNumber} ({account.accountName})
                  </option>
                ))}
              </Select>
            )}
          </div>

          <Button
            onClick={requestWithdrawal}
            disabled={loading || !amount || !selectedBankAccountId}
            className="w-full"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <ArrowUpRight className="w-4 h-4 mr-2" />
                Request Withdrawal
              </>
            )}
          </Button>
        </div>
      )}

      {/* History Tab */}
      {activeTab === "history" && (
        <div className="space-y-4">
          {withdrawals.length === 0 ? (
            <div className="text-center py-12 bg-cream rounded-lg">
              <p className="text-ink-2">No withdrawal history yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {withdrawals.map((withdrawal) => (
                <div
                  key={withdrawal.id}
                  className="bg-white border border-line rounded-lg p-4"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-semibold">{formatCurrency(withdrawal.amount)}</p>
                      <p className="text-sm text-ink-2">
                        {withdrawal.bankName} • {withdrawal.accountNumber}
                      </p>
                    </div>
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusBadge(
                        withdrawal.status
                      )}`}
                    >
                      {withdrawal.status}
                    </span>
                  </div>
                  <div className="text-xs text-ink-3 space-y-1">
                    <p>Reference: {withdrawal.reference}</p>
                    <p>Fee: {formatCurrency(withdrawal.fee)}</p>
                    <p>
                      {new Date(withdrawal.createdAt).toLocaleDateString("en-NG", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    {withdrawal.failureReason && (
                      <p className="text-red-600">Error: {withdrawal.failureReason}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Bank Accounts Tab */}
      {activeTab === "accounts" && (
        <div className="space-y-6">
          {/* Add New Account Form */}
          <div className="bg-cream rounded-lg p-4 space-y-4">
            <h3 className="font-semibold">Add New Bank Account</h3>

            <div>
              <label className="block text-sm font-medium text-ink-2 mb-2">
                Bank
              </label>
              <Select value={bankCode} onChange={(e) => setBankCode(e.target.value)}>
                <option value="">Select bank</option>
                {banks.map((bank) => (
                  <option key={bank.code} value={bank.code}>
                    {bank.name}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium text-ink-2 mb-2">
                Account Number
              </label>
              <div className="flex gap-2">
                <Input
                  type="text"
                  placeholder="10-digit account number"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  maxLength={10}
                />
                <Button
                  onClick={verifyAccount}
                  disabled={verifyingAccount || !bankCode || accountNumber.length !== 10}
                  variant="outline"
                >
                  {verifyingAccount ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    "Verify"
                  )}
                </Button>
              </div>
            </div>

            {accountName && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <p className="text-sm font-medium text-green-800">
                  Account Name: {accountName}
                </p>
              </div>
            )}

            <Button
              onClick={addBankAccount}
              disabled={loading || !bankCode || !accountNumber || !accountName}
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Bank Account
                </>
              )}
            </Button>
          </div>

          {/* Saved Accounts */}
          <div>
            <h3 className="font-semibold mb-4">Saved Bank Accounts</h3>
            {bankAccounts.length === 0 ? (
              <div className="text-center py-8 bg-cream rounded-lg">
                <p className="text-ink-2">No bank accounts saved yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {bankAccounts.map((account) => (
                  <div
                    key={account.id}
                    className="bg-white border border-line rounded-lg p-4 flex justify-between items-center"
                  >
                    <div>
                      <p className="font-semibold">{account.bankName}</p>
                      <p className="text-sm text-ink-2">{account.accountNumber}</p>
                      <p className="text-sm text-ink-2">{account.accountName}</p>
                      {account.isDefault && (
                        <span className="inline-block mt-1 px-2 py-0.5 bg-purple-100 text-purple-800 text-xs rounded-full">
                          Default
                        </span>
                      )}
                    </div>
                    <Button
                      onClick={() => deleteBankAccount(account.id)}
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <Close className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
