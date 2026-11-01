"use client";

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { Loader2 } from "@/components/icons";

interface BlockedAccount {
  id: string;
  bankName: string;
  accountName: string;
  accountNumberLast4: string;
}

interface ReviewRow {
  userId: string;
  userName: string;
  userEmail: string;
  depositorName: string | null;
  approvedName: string | null;
  accounts: BlockedAccount[];
}

/**
 * The review queue for blocked payouts.
 *
 * Every action here writes an audit entry, and the approval is stored beside the
 * frozen depositor name rather than over it. The copy says so, because an
 * operator who believes they are editing the deposit record would be making a
 * different decision from the one this page records.
 */
export function PayoutNameManager() {
  const { addToast } = useToast();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { name: string; reason: string }>>({});

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/admin/payout-names", { signal, cache: "no-store" });
      const data = await response.json();
      if (signal?.aborted) return;
      if (response.ok && data.ok) {
        setRows(data.users as ReviewRow[]);
      } else {
        addToast({ type: "error", message: data.error || "Failed to load payout names" });
      }
    } catch {
      if (!signal?.aborted) addToast({ type: "error", message: "Failed to load payout names" });
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    const controller = new AbortController();
    // Deferred like the other admin managers: a state update made synchronously
    // inside the effect body would cascade renders on every mount.
    queueMicrotask(() => {
      if (!controller.signal.aborted) void load(controller.signal);
    });
    return () => controller.abort();
  }, [load]);

  function draftFor(userId: string) {
    return drafts[userId] ?? { name: "", reason: "" };
  }

  function setDraft(userId: string, patch: Partial<{ name: string; reason: string }>) {
    setDrafts((current) => ({ ...current, [userId]: { ...draftFor(userId), ...patch } }));
  }

  async function approve(row: ReviewRow) {
    const draft = draftFor(row.userId);
    if (draft.name.trim().length < 2) {
      addToast({ type: "error", message: "Enter the name the bank has on the account." });
      return;
    }
    if (draft.reason.trim().length < 5) {
      addToast({ type: "error", message: "Record why these names are the same person." });
      return;
    }
    if (!confirm(`Approve "${draft.name.trim()}" as a payout name for ${row.userEmail}? Payouts to an account in this name will then be allowed.`)) {
      return;
    }
    setBusy(row.userId);
    try {
      const response = await fetch("/api/admin/payout-names", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: row.userId, approvedName: draft.name, reason: draft.reason }),
      });
      const data = await response.json();
      if (response.ok && data.ok) {
        addToast({ type: "success", message: "Payout name approved" });
        setDrafts((current) => ({ ...current, [row.userId]: { name: "", reason: "" } }));
        await load();
      } else {
        addToast({ type: "error", message: data.error || "Failed to approve the payout name" });
      }
    } catch {
      addToast({ type: "error", message: "Failed to approve the payout name" });
    } finally {
      setBusy(null);
    }
  }

  async function revoke(row: ReviewRow) {
    if (!confirm(`Revoke the approved payout name for ${row.userEmail}? The depositor-name rule applies again immediately.`)) return;
    setBusy(row.userId);
    try {
      const response = await fetch("/api/admin/payout-names", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: row.userId }),
      });
      const data = await response.json();
      if (response.ok && data.ok) {
        addToast({ type: "success", message: "Approval revoked" });
        await load();
      } else {
        addToast({ type: "error", message: data.error || "Failed to revoke the approval" });
      }
    } catch {
      addToast({ type: "error", message: "Failed to revoke the approval" });
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-[0.86rem] text-ink-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading blocked payouts…
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-line bg-white px-5 py-8 text-center text-[0.86rem] text-ink-3">
        Nothing is blocked. Every saved bank account matches the name that funded its wallet.
      </p>
    );
  }

  return (
    <div className="grid gap-4">
      {rows.map((row) => {
        const draft = draftFor(row.userId);
        return (
          <section key={row.userId} className="rounded-2xl border border-line bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[0.95rem] font-semibold text-ink">{row.userName}</p>
                <p className="truncate text-meta text-ink-2">{row.userEmail}</p>
                <p className="mt-1.5 text-meta text-ink-2">
                  Depositor name on record: <strong className="text-ink">{row.depositorName ?? "none recorded"}</strong>
                </p>
              </div>
              {row.approvedName ? (
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-micro font-semibold text-emerald-700">
                  Approved: {row.approvedName}
                </span>
              ) : (
                <span className="rounded-full bg-amber-50 px-2.5 py-1 text-micro font-semibold text-amber-800">
                  Payouts blocked
                </span>
              )}
            </div>

            <ul className="mt-3 grid gap-1.5">
              {row.accounts.map((account) => (
                <li key={account.id} className="rounded-xl border border-line bg-cream/50 px-3 py-2 text-meta text-ink-2">
                  <strong className="text-ink">{account.bankName}</strong> · ••••{account.accountNumberLast4} ·{" "}
                  {account.accountName}
                </li>
              ))}
            </ul>

            <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto]">
              <label className="grid gap-1 text-meta text-ink-2">
                Reviewed name
                <input
                  value={draft.name}
                  onChange={(event) => setDraft(row.userId, { name: event.target.value })}
                  maxLength={200}
                  placeholder="Name exactly as the bank has it"
                  className="field !py-2 !text-[0.84rem]"
                  aria-label={`Reviewed payout name for ${row.userEmail}`}
                />
              </label>
              <label className="grid gap-1 text-meta text-ink-2">
                Why they are the same person
                <input
                  value={draft.reason}
                  onChange={(event) => setDraft(row.userId, { reason: event.target.value })}
                  maxLength={500}
                  placeholder="Bank statement checked, ticket #1234"
                  className="field !py-2 !text-[0.84rem]"
                  aria-label={`Reason for approving a payout name for ${row.userEmail}`}
                />
              </label>
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  onClick={() => void approve(row)}
                  disabled={busy === row.userId}
                  className="btn btn-primary !px-4 !py-2.5 !text-[0.8rem] disabled:opacity-50"
                >
                  {busy === row.userId ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve name"}
                </button>
                {row.approvedName && (
                  <button
                    type="button"
                    onClick={() => void revoke(row)}
                    disabled={busy === row.userId}
                    className="btn border border-line bg-white !px-4 !py-2.5 !text-[0.8rem] text-ink hover:border-rose-200 disabled:opacity-50"
                  >
                    Revoke
                  </button>
                )}
              </div>
            </div>

            <p className="mt-2 text-micro leading-relaxed text-ink-3">
              Approving does not edit the depositor name frozen on the deposit. It allows payouts to this
              customer&rsquo;s accounts in the reviewed name, and every approval and revocation is written to the
              audit log.
            </p>
          </section>
        );
      })}
    </div>
  );
}
