"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type QueueItem = {
  id: string;
  service: string;
  productName: string;
  rating: number;
  headline: string | null;
  body: string;
  status: string;
  createdAt: string;
  customerEmail: string;
  moderatorNote: string | null;
  publishedAt: string | null;
};

/**
 * Publish or reject, one review at a time.
 *
 * The note is shown to the customer when a review is rejected, so the placeholder
 * says what to write rather than inviting an internal remark. Every decision
 * posts and then refreshes the server component, so an item decided in another
 * tab disappears instead of being re-offered.
 */
export function ModerationQueue({ items }: { items: QueueItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function decide(id: string, decision: "publish" | "reject") {
    if (busy) return;
    setBusy(id);
    setError(null);
    try {
      const response = await fetch("/api/admin/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId: id, decision, note: notes[id]?.trim() || undefined }),
      });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setError(data.error ?? "Could not update the review.");
        return;
      }
      setNotes((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      router.refresh();
    } catch {
      setError("Network hiccup. The review was not changed.");
    } finally {
      setBusy(null);
    }
  }

  if (items.length === 0) {
    return (
      <p className="rounded-2xl border border-line bg-white p-5 text-[0.9rem] text-ink-2">
        Nothing in this queue. Reviews appear here the moment a customer writes one.
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-[0.8rem] font-medium text-red-700">
          {error}
        </p>
      )}
      {items.map((item) => {
        const decided = item.status !== "pending";
        return (
          <article key={item.id} className="rounded-2xl border border-line bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="text-[0.95rem] font-semibold">
                  {item.productName}
                  <span className="ml-2 font-normal text-ink-3">{item.rating} / 5</span>
                </h2>
                <p className="mt-0.5 text-[0.74rem] text-ink-3">
                  {item.customerEmail} · {new Date(item.createdAt).toLocaleString("en-NG")} · {item.service}
                </p>
              </div>
              <span className="rounded-full border border-line px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.1em] text-ink-2">
                {item.status}
              </span>
            </div>

            {item.headline && <p className="mt-3 text-[0.9rem] font-medium">{item.headline}</p>}
            <p className="mt-1 whitespace-pre-line text-[0.88rem] leading-relaxed text-ink-2">{item.body}</p>
            {item.moderatorNote && (
              <p className="mt-2 text-[0.78rem] text-ink-3">Note on record: {item.moderatorNote}</p>
            )}

            {!decided && (
              <div className="mt-4 grid gap-2">
                <input
                  className="field"
                  maxLength={500}
                  placeholder="Note for the customer if you reject it (optional, shown to them)"
                  value={notes[item.id] ?? ""}
                  onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy === item.id}
                    onClick={() => decide(item.id, "publish")}
                    className="btn btn-primary btn-sm"
                  >
                    {busy === item.id ? "Working…" : "Publish"}
                  </button>
                  <button
                    type="button"
                    disabled={busy === item.id}
                    onClick={() => decide(item.id, "reject")}
                    className="btn btn-ghost btn-sm"
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
