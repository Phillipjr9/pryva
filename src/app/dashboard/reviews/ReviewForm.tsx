"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight } from "@/components/icons";

export type ReviewableOrder = {
  id: string;
  reference: string;
  productName: string;
  planLabel: string;
  service: string;
  status: string;
};

const BODY_MAX = 1200;
const BODY_MIN = 20;

/**
 * One review, one order, one submission.
 *
 * The form mirrors the server's rules but does not enforce them: the API
 * re-validates everything, and the order must still be the caller's own and
 * still delivered at the moment of submission. The copy states that a review is
 * pending until an operator publishes it, so nobody expects it to appear
 * immediately.
 */
export function ReviewForm({ orders }: { orders: ReviewableOrder[] }) {
  const router = useRouter();
  const [orderId, setOrderId] = useState(orders[0]?.id ?? "");
  const [rating, setRating] = useState(5);
  const [headline, setHeadline] = useState("");
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (orders.length === 0) {
    return (
      <p className="rounded-2xl border border-line bg-white p-5 text-[0.9rem] leading-relaxed text-ink-2">
        Nothing to review yet. An order becomes reviewable once it has been delivered.
      </p>
    );
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, rating, headline, body }),
      });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setError(data.error ?? "Could not save the review.");
        return;
      }
      setSent(true);
      setHeadline("");
      setBody("");
      router.refresh();
    } catch {
      setError("Network hiccup. Your review was not saved.");
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
        <h2 className="text-[1rem] font-semibold text-emerald-900">Thank you — it is in the queue.</h2>
        <p className="mt-1 text-[0.88rem] leading-relaxed text-emerald-800">
          An operator reads it before it is published, usually within a day. You can see its status
          below; it will not appear on the public page until then.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4 rounded-2xl border border-line bg-white p-5">
      <div>
        <label htmlFor="review-order" className="field-label">
          Which order?
        </label>
        <select
          id="review-order"
          className="field"
          value={orderId}
          onChange={(event) => setOrderId(event.target.value)}
        >
          {orders.map((order) => (
            <option key={order.id} value={order.id}>
              {order.productName} · {order.planLabel} · {order.reference}
            </option>
          ))}
        </select>
      </div>

      <fieldset>
        <legend className="field-label">Rating</legend>
        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              type="button"
              aria-label={`${value} out of 5`}
              aria-pressed={rating === value}
              onClick={() => setRating(value)}
              className={
                rating >= value
                  ? "grid h-9 w-9 place-items-center rounded-lg border border-amber-300 bg-amber-50 text-amber-600"
                  : "grid h-9 w-9 place-items-center rounded-lg border border-line bg-white text-ink-3"
              }
            >
              ★
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="review-headline" className="field-label">
          Headline <span className="font-normal text-ink-3">(optional, 80 characters)</span>
        </label>
        <input
          id="review-headline"
          className="field"
          maxLength={80}
          value={headline}
          onChange={(event) => setHeadline(event.target.value)}
          placeholder="The code arrived in a minute"
        />
      </div>

      <div>
        <label htmlFor="review-body" className="field-label">
          Your review
        </label>
        <textarea
          id="review-body"
          className="field min-h-32"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={BODY_MAX}
          placeholder="What you bought, whether it worked, and what you would tell someone considering it."
        />
        <p className="mt-1 text-[0.72rem] text-ink-3">
          {body.trim().length}/{BODY_MAX} · at least {BODY_MIN} characters
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-[0.78rem] font-medium text-red-700">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || body.trim().length < BODY_MIN || !orderId}
          className="btn btn-primary btn-sm"
        >
          {pending ? "Submitting…" : "Submit for review"}
          {!pending && <ArrowRight className="h-3.5 w-3.5" />}
        </button>
        <span className="text-[0.74rem] text-ink-3">
          Published only after an operator checks it. Never edited by us.
        </span>
      </div>
    </form>
  );
}
