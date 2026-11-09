"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/ui/Toast";
import { Loader2 } from "@/components/icons";
import { cn } from "@/lib/platform/utils";

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

type Filter = "all" | "waiting" | "approved";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "waiting", label: "Waiting" },
  { value: "approved", label: "Approved" },
];

/** The minimum the endpoint accepts, mirrored here so the hint can say it. */
const MIN_REASON = 5;
const MIN_NAME = 2;

function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}

/** Names are compared loosely: case and spacing are not what the rule is about. */
function normalise(value: string | null): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The review queue for blocked payouts.
 *
 * Every action here writes an audit entry, and the approval is stored beside the
 * frozen depositor name rather than over it. The copy says so, because an
 * operator who believes they are editing the deposit record would be making a
 * different decision from the one this page records.
 *
 * Reading order on each card is deliberate: who is blocked and why, then the
 * evidence, then the decision. The reason is compulsory at the endpoint and here,
 * so an approval can never be an unexplained payment to somebody.
 */
export function PayoutNameManager() {
  const { addToast } = useToast();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { name: string; reason: string }>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/admin/payout-names", { signal, cache: "no-store" });
      const data = await response.json();
      if (signal?.aborted) return;
      if (response.ok && data.ok) {
        setRows(data.users as ReviewRow[]);
        setLoadError(null);
      } else {
        // Shown in the page as well as the toast: a toast is gone in seconds, and
        // an empty queue that is actually an error reads as "nobody is blocked".
        setLoadError(data.error || "Failed to load payout names");
        addToast({ type: "error", message: data.error || "Failed to load payout names" });
      }
    } catch {
      if (!signal?.aborted) {
        setLoadError("Could not reach the server.");
        addToast({ type: "error", message: "Failed to load payout names" });
      }
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

  async function refresh() {
    setLoading(true);
    await load();
  }

  async function approve(row: ReviewRow) {
    const draft = draftFor(row.userId);
    if (draft.name.trim().length < MIN_NAME) {
      addToast({ type: "error", message: "Enter the name the bank has on the account." });
      return;
    }
    if (draft.reason.trim().length < MIN_REASON) {
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
    if (!confirm(`Revoke the approved payout name for ${row.userEmail}? The profile-name rule applies again immediately.`)) return;
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

  const stats = useMemo(() => {
    const waiting = rows.filter((row) => !row.approvedName).length;
    const accounts = rows.reduce((total, row) => total + row.accounts.length, 0);
    return { total: rows.length, waiting, approved: rows.length - waiting, accounts };
  }, [rows]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === "waiting" && row.approvedName) return false;
      if (filter === "approved" && !row.approvedName) return false;
      if (!term) return true;
      return (
        row.userName.toLowerCase().includes(term) ||
        row.userEmail.toLowerCase().includes(term) ||
        (row.depositorName ?? "").toLowerCase().includes(term) ||
        row.accounts.some(
          (account) =>
            account.accountName.toLowerCase().includes(term) || account.bankName.toLowerCase().includes(term),
        )
      );
    });
  }, [rows, query, filter]);

  if (loading) {
    return (
      <div className="grid gap-4" aria-busy="true">
        <span className="sr-only">Loading blocked payouts…</span>
        {[0, 1].map((key) => (
          <div key={key} className="animate-pulse rounded-2xl border border-line bg-white p-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-cream" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-36 rounded bg-cream" />
                <div className="h-2.5 w-52 rounded bg-cream" />
              </div>
            </div>
            <div className="mt-4 h-12 rounded-xl bg-cream/70" />
            <div className="mt-3 h-16 rounded-xl bg-cream/50" />
          </div>
        ))}
      </div>
    );
  }

  // A failed read is checked before the empty state, not after: `rows` is also
  // empty when the request failed, and "Nothing is blocked" about a queue that
  // could not be read would send support away from a customer who is blocked.
  if (loadError && rows.length === 0) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-amber-200 bg-amber-50 px-6 py-10 text-center text-amber-900"
      >
        <p className="text-[0.95rem] font-semibold">The queue could not be read.</p>
        <p className="mx-auto mt-1 max-w-md text-meta leading-relaxed">
          {loadError} — this is not the same as nobody being blocked, so do not treat the queue as
          clear.
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[0.82rem] font-medium text-amber-900 hover:bg-amber-100"
        >
          <Loader2 className="h-3.5 w-3.5" /> Try again
        </button>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-white px-6 py-12 text-center">
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
          ✓
        </span>
        <p className="mt-3 text-[0.95rem] font-medium text-ink">Nothing is blocked</p>
        <p className="mx-auto mt-1 max-w-md text-meta leading-relaxed text-ink-2">
          Every saved bank account passes the current profile-name or approved-name check. This does not verify the payer. Re-run this page after a
          customer updates their payout account.
        </p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="mt-4 inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-1.5 text-[0.82rem] font-medium text-ink hover:border-lav-300"
        >
          <Loader2 className="h-3.5 w-3.5" /> Check again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* The queue at a glance: what needs a decision versus what already has one. */}
      <dl className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Waiting for a decision", value: stats.waiting, tone: "text-amber-800" },
          { label: "Approved", value: stats.approved, tone: "text-emerald-700" },
          { label: "Blocked accounts", value: stats.accounts, tone: "text-ink" },
        ].map((tile) => (
          <div key={tile.label} className="rounded-2xl border border-line bg-white px-4 py-3">
            <dt className="text-meta uppercase tracking-wide text-ink-3">{tile.label}</dt>
            <dd className={cn("mt-0.5 text-[1.35rem] font-semibold leading-tight", tile.tone)}>{tile.value}</dd>
          </div>
        ))}
      </dl>

      {loadError && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[0.84rem] text-amber-900"
        >
          <span>
            <strong className="font-semibold">The queue could not be read.</strong> {loadError} — an
            empty list would not mean nobody is blocked.
          </span>
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-lg border border-amber-300 bg-white px-3 py-1 text-meta font-semibold text-amber-900 hover:bg-amber-100"
          >
            Try again
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-[14rem] flex-1">
          <span className="sr-only">Search blocked payouts</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, email, bank or account name"
            className="field !py-2 !text-[0.84rem] w-full"
          />
        </label>

        <div className="inline-flex rounded-lg border border-line bg-white p-0.5" role="group" aria-label="Filter by state">
          {FILTERS.map((option) => {
            const count =
              option.value === "all" ? stats.total : option.value === "waiting" ? stats.waiting : stats.approved;
            const active = filter === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setFilter(option.value)}
                aria-pressed={active}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[0.82rem] font-medium transition-colors",
                  active ? "bg-lav-50 text-lav-800" : "text-ink-2 hover:bg-cream",
                )}
              >
                {option.label}
                <span className="ml-1.5 text-meta text-ink-3">{count}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => void refresh()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-2 text-[0.82rem] font-medium text-ink hover:border-lav-300"
        >
          <Loader2 className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line bg-white px-5 py-10 text-center text-[0.86rem] text-ink-3">
          Nothing matches this search.
        </p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {visible.map((row) => {
            const draft = draftFor(row.userId);
            const working = busy === row.userId;
            const nameReady = draft.name.trim().length >= MIN_NAME;
            const reasonReady = draft.reason.trim().length >= MIN_REASON;
            const ready = nameReady && reasonReady;

            return (
              <article
                key={row.userId}
                className={cn(
                  "flex flex-col overflow-hidden rounded-2xl border bg-white",
                  row.approvedName ? "border-emerald-200" : "border-line",
                )}
              >
                <header
                  className={cn(
                    "flex items-start justify-between gap-3 border-b px-5 py-4",
                    row.approvedName ? "border-emerald-100 bg-emerald-50/40" : "border-line/70 bg-cream/40",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[0.8rem] font-semibold",
                        row.approvedName ? "bg-emerald-100 text-emerald-800" : "bg-lav-100 text-lav-800",
                      )}
                    >
                      {initials(row.userName)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[0.95rem] font-semibold text-ink">{row.userName}</p>
                      <p className="truncate text-meta text-ink-2">{row.userEmail}</p>
                    </div>
                  </div>
                  {row.approvedName ? (
                    <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-micro font-semibold text-emerald-700">
                      Approved: {row.approvedName}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-amber-50 px-2.5 py-1 text-micro font-semibold text-amber-800">
                      Payouts blocked
                    </span>
                  )}
                </header>

                <div className="flex-1 px-5 py-4">
                  {/* Why the rule fired, in the operator's terms. */}
                  <p className="text-meta text-ink-2">
                    Profile name recorded at first top-up:{" "}
                    <strong className="text-ink">{row.depositorName ?? "none recorded"}</strong>
                  </p>
                  {!row.depositorName && (
                    <p className="mt-1 text-micro leading-relaxed text-ink-3">
                      No completed top-up has a recorded profile name, so there is nothing to match against.
                      Approving here is a decision about identity — check it before you make it.
                    </p>
                  )}

                  <p className="mt-3 text-meta font-semibold uppercase tracking-wide text-ink-3">
                    {row.accounts.length === 1 ? "Account a payout would refuse" : "Accounts a payout would refuse"}
                  </p>
                  <ul className="mt-1.5 grid gap-1.5">
                    {row.accounts.map((account) => {
                      const differs = normalise(account.accountName) !== normalise(row.depositorName);
                      return (
                        <li
                          key={account.id}
                          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-xl border border-line bg-cream/50 px-3 py-2 text-meta"
                        >
                          <span className="text-ink-2">
                            <strong className="text-ink">{account.bankName}</strong>
                            {" · "}
                            <span className="tabular-nums">••••{account.accountNumberLast4}</span>
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className={cn("text-ink", differs ? "font-medium" : "")}>{account.accountName}</span>
                            {differs && (
                              <span
                                className="rounded-full bg-amber-50 px-1.5 py-0.5 text-micro font-semibold text-amber-800"
                                title="Does not match the saved profile name"
                              >
                                differs
                              </span>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>

                  <div className="mt-4 grid gap-2">
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
                      <span className="text-micro text-ink-3">
                        {draft.reason.trim().length < MIN_REASON
                          ? `At least ${MIN_REASON} characters — the next administrator reads this.`
                          : `${draft.reason.trim().length} / 500`}
                      </span>
                    </label>
                  </div>
                </div>

                <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line/70 px-5 py-3">
                  <p className="max-w-sm text-micro leading-relaxed text-ink-3">
                    Approving does not edit the profile name recorded at the first top-up. It allows payouts to
                    this customer&rsquo;s accounts in the reviewed name, and every approval and revocation is
                    written to the audit log.
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void approve(row)}
                      disabled={working}
                      className={cn(
                        "btn btn-primary inline-flex items-center gap-1.5 !px-4 !py-2.5 !text-[0.8rem] disabled:opacity-50",
                        !ready && "opacity-60",
                      )}
                      aria-describedby={ready ? undefined : `approve-hint-${row.userId}`}
                    >
                      {working && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Approve name
                    </button>
                    {row.approvedName && (
                      <button
                        type="button"
                        onClick={() => void revoke(row)}
                        disabled={working}
                        className="btn border border-line bg-white !px-4 !py-2.5 !text-[0.8rem] text-ink hover:border-rose-200 disabled:opacity-50"
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                </footer>
                {!ready && (
                  <span id={`approve-hint-${row.userId}`} className="sr-only">
                    Enter the reviewed name and a reason before approving.
                  </span>
                )}
              </article>
            );
          })}
        </div>
      )}

      <p role="status" aria-live="polite" className="sr-only">
        {working_status(busy)}
      </p>
    </div>
  );
}

/** Announced to screen readers while a decision is being saved. */
function working_status(busy: string | null): string {
  return busy ? "Saving the payout name decision…" : "";
}
