"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/components/ui/Toast";
import { Loader2, CheckCircle, XCircle, Clock, Filter } from "@/components/icons";

interface Withdrawal {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  amount: number;
  fee: number;
  bankName: string;
  accountNumber: string;
  accountName: string;
  status: string;
  reference: string;
  paystackReference?: string | null;
  transferReference?: string | null;
  failureReason?: string;
  /** Advisory fraud flag; the payout flow itself is unchanged by it. */
  riskLevel?: string;
  riskReasons?: string | null;
  createdAt: string;
  processedAt?: string;
  completedAt?: string;
}

export function WithdrawalsManager() {
  const { addToast } = useToast();
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const fetchWithdrawals = useCallback(async (signal?: AbortSignal) => {
    try {
      const params = new URLSearchParams();
      if (filter !== "all") {
        params.set("status", filter);
      }

      const response = await fetch(`/api/admin/withdrawals?${params}`, { signal });
      const data = await response.json();
      if (signal?.aborted) return;

      if (data.ok) {
        setWithdrawals(data.withdrawals);
      } else {
        addToast({ type: "error", message: data.error || "Failed to fetch withdrawals" });
      }
    } catch (error) {
      if (!signal?.aborted) addToast({ type: "error", message: "Failed to fetch withdrawals" });
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [filter, addToast]);

  useEffect(() => {
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) void fetchWithdrawals(controller.signal);
    });
    return () => controller.abort();
  }, [fetchWithdrawals]);

  async function processWithdrawal(id: string, action: "approve" | "reject") {
    const confirmation = action === "approve"
      ? "Approve this request and initiate a Paystack transfer? Initiation is not settlement. Check Paystack for any merchant authorization and final status before retrying or refunding."
      : "Reject this pending request and refund its reserved wallet amount?";
    if (!confirm(confirmation)) {
      return;
    }

    setProcessing(id);

    try {
      const response = await fetch("/api/admin/withdrawals", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });

      const data = await response.json();

      if (response.ok && data.ok) {
        addToast({ type: data.needsReview ? "warning" : "success", message: data.message || (action === "approve" ? "Transfer initiated; settlement still requires verification." : "Withdrawal rejected and refunded.") });
        void fetchWithdrawals();
      } else {
        addToast({ type: "error", message: data.error || (action === "approve" ? "Transfer outcome unconfirmed. Check Paystack before retrying or refunding." : "Rejection outcome unconfirmed. Refresh the request before trying again.") });
        void fetchWithdrawals();
      }
    } catch {
      addToast({ type: "error", message: action === "approve" ? "Transfer outcome unconfirmed. Check Paystack before retrying or refunding." : "Rejection outcome unconfirmed. Refresh the request before trying again." });
      void fetchWithdrawals();
    } finally {
      setProcessing(null);
    }
  }

  async function completeWithdrawal(id: string) {
    const note = prompt("After checking Paystack, enter the settlement reference or reconciliation note (do not include personal details):");
    if (!note?.trim()) return;
    if (!confirm("Have you verified the transfer's final settlement, amount and recipient in Paystack?")) return;

    setProcessing(id);

    try {
      const response = await fetch("/api/admin/withdrawals", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "complete", reconciliationConfirmed: true, reason: note.trim() }),
      });

      const data = await response.json();

      if (data.ok) {
        addToast({ type: "success", message: "Withdrawal marked as completed" });
        fetchWithdrawals();
      } else {
        addToast({ type: "error", message: data.error || "Failed to complete withdrawal" });
      }
    } catch {
      addToast({ type: "error", message: "Completion outcome unconfirmed. Refresh the request and check Paystack before trying again." });
      void fetchWithdrawals();
    } finally {
      setProcessing(null);
    }
  }

  const getStatusBadge = (status: string) => {
    const config = {
      pending: { color: "bg-yellow-100 text-yellow-800", icon: Clock },
      processing: { color: "bg-blue-100 text-blue-800", icon: Loader2 },
      completed: { color: "bg-green-100 text-green-800", icon: CheckCircle },
      failed: { color: "bg-red-100 text-red-800", icon: XCircle },
      rejected: { color: "bg-red-100 text-red-800", icon: XCircle },
    };

    const { color, icon: Icon } = config[status as keyof typeof config] || {
      color: "bg-gray-100 text-gray-800",
      icon: Clock,
    };

    return (
      <Badge className={`${color} flex items-center gap-1`}>
        <Icon className="w-3 h-3" />
        {status}
      </Badge>
    );
  };

  const stats = {
    total: withdrawals.length,
    pending: withdrawals.filter((w) => w.status === "pending").length,
    processing: withdrawals.filter((w) => w.status === "processing").length,
    completed: withdrawals.filter((w) => w.status === "completed").length,
    failed: withdrawals.filter((w) => w.status === "failed" || w.status === "rejected").length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-sm text-gray-600">Total</p>
          <p className="text-2xl font-bold">{stats.total}</p>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <p className="text-sm text-yellow-700">Pending</p>
          <p className="text-2xl font-bold text-yellow-800">{stats.pending}</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm text-blue-700">Processing</p>
          <p className="text-2xl font-bold text-blue-800">{stats.processing}</p>
        </div>
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <p className="text-sm text-green-700">Completed</p>
          <p className="text-2xl font-bold text-green-800">{stats.completed}</p>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-700">Failed/Rejected</p>
          <p className="text-2xl font-bold text-red-800">{stats.failed}</p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <Filter className="w-4 h-4 text-gray-600" />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="processing">Processing</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {/* Withdrawals List */}
      {withdrawals.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <p className="text-gray-600">No withdrawal requests found</p>
        </div>
      ) : (
        <div className="space-y-4">
          {withdrawals.map((withdrawal) => (
            <div
              key={withdrawal.id}
              className="bg-white border border-gray-200 rounded-lg p-6"
            >
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <p className="text-xl font-bold">{formatCurrency(withdrawal.amount)}</p>
                    {getStatusBadge(withdrawal.status)}
                  </div>
                  <p className="text-sm text-gray-600">
                    {withdrawal.userName} • {withdrawal.userEmail}
                  </p>
                </div>
                <p className="text-xs text-gray-500">
                  {new Date(withdrawal.createdAt).toLocaleDateString("en-NG", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
                <div>
                  <p className="text-gray-600">Bank</p>
                  <p className="font-medium">{withdrawal.bankName}</p>
                </div>
                <div>
                  <p className="text-gray-600">Account Number</p>
                  <p className="font-medium">{withdrawal.accountNumber}</p>
                </div>
                <div>
                  <p className="text-gray-600">Account Name</p>
                  <p className="font-medium">{withdrawal.accountName}</p>
                </div>
                <div>
                  <p className="text-gray-600">Reference</p>
                  <p className="font-medium font-mono text-xs">{withdrawal.reference}</p>
                </div>
                <div>
                  <p className="text-gray-600">Fee</p>
                  <p className="font-medium">{formatCurrency(withdrawal.fee)}</p>
                </div>
                <div>
                  <p className="text-gray-600">Total wallet deduction (payout + fee)</p>
                  <p className="font-medium text-green-600">
                    {formatCurrency(withdrawal.amount + withdrawal.fee)}
                  </p>
                </div>
              </div>

              {withdrawal.paystackReference && (
                <p className="mb-2 text-xs text-gray-600">Paystack reference: <span className="font-mono">{withdrawal.paystackReference}</span></p>
              )}
              {withdrawal.status === "processing" && !withdrawal.paystackReference && (
                <p className="mb-2 text-xs text-red-800">Legacy transfer: the Paystack reference was not saved by this version. Check Paystack manually using the original request details.</p>
              )}
              {withdrawal.transferReference && (
                <p className="mb-3 text-xs text-gray-600">Paystack transfer code: <span className="font-mono">{withdrawal.transferReference}</span></p>
              )}
              {withdrawal.status === "processing" && !withdrawal.transferReference && (
                <p className="mb-3 text-sm text-red-800">Transfer outcome is unconfirmed. Reconcile it manually; do not retry or refund while it may be in flight.</p>
              )}
              {withdrawal.riskLevel && withdrawal.riskLevel !== "low" && (
                <div
                  className={`mb-4 rounded-lg border p-3 ${
                    withdrawal.riskLevel === "high"
                      ? "border-red-200 bg-red-50"
                      : "border-amber-200 bg-amber-50"
                  }`}
                >
                  <p
                    className={`text-sm font-semibold ${
                      withdrawal.riskLevel === "high" ? "text-red-800" : "text-amber-800"
                    }`}
                  >
                    Fraud signal: {withdrawal.riskLevel}
                  </p>
                  <p className={`text-sm ${withdrawal.riskLevel === "high" ? "text-red-700" : "text-amber-700"}`}>
                    {withdrawal.riskReasons ?? "Flagged by the risk assessment."}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    Advisory only. Check the reasons before approving; the request has not been actioned.
                  </p>
                </div>
              )}
              {withdrawal.failureReason && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-800">
                    <strong>{withdrawal.status === "processing" ? "Review note:" : "Failure reason:"}</strong> {withdrawal.failureReason}
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                {withdrawal.status === "pending" && (
                  <>
                    <Button
                      onClick={() => processWithdrawal(withdrawal.id, "approve")}
                      disabled={processing === withdrawal.id}
                      variant="primary"
                      size="sm"
                    >
                      {processing === withdrawal.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CheckCircle className="w-4 h-4" />
                      )}
                      <span className="ml-2">Approve & Process</span>
                    </Button>
                    <Button
                      onClick={() => processWithdrawal(withdrawal.id, "reject")}
                      disabled={processing === withdrawal.id}
                      variant="secondary"
                      size="sm"
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <XCircle className="w-4 h-4" />
                      <span className="ml-2">Reject</span>
                    </Button>
                  </>
                )}
                {withdrawal.status === "processing" && withdrawal.transferReference && (
                  <Button
                    onClick={() => completeWithdrawal(withdrawal.id)}
                    disabled={processing === withdrawal.id}
                    variant="primary"
                    size="sm"
                  >
                    {processing === withdrawal.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckCircle className="w-4 h-4" />
                    )}
                    <span className="ml-2">Mark as Completed</span>
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
