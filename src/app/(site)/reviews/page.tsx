import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "@/components/icons";
import { listPublishedReviews } from "@/lib/reviews";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Customer reviews",
  description:
    "Reviews from customers whose orders were delivered. Every review is tied to a real purchase and checked before it is published — nothing here is written by Pryva.",
  alternates: { canonical: "/reviews" },
  openGraph: {
    title: "Customer reviews | Pryva",
    description:
      "Verified-purchase reviews from delivered orders. No invented testimonials, and no customer names published.",
    url: "/reviews",
    type: "website",
  },
};

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <span key={star} aria-hidden className={star <= rating ? "text-amber-500" : "text-line"}>
          ★
        </span>
      ))}
    </span>
  );
}

function formatDate(value: Date | string | null) {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString("en-NG", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * Published reviews only, and deliberately anonymous.
 *
 * The list carries no customer identity: not a name, not an initial, not a
 * masked email. A review proves the order was delivered; it is not a reason to
 * publish who holds a wallet here. `listPublishedReviews` selects those fields
 * itself, so a later template change cannot accidentally widen it.
 */
export default async function ReviewsPage() {
  const reviews = await listPublishedReviews(30);
  const average =
    reviews.length > 0
      ? Math.round((reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length) * 10) / 10
      : null;

  return (
    <main>
      <section className="border-b border-line/70 bg-gradient-to-b from-cream to-white">
        <div className="shell py-14 sm:py-20">
          <div className="max-w-3xl">
            <span className="eyebrow">Customer reviews</span>
            <h1 className="mt-3 text-[2.1rem] font-semibold leading-[1.1] tracking-tight text-ink sm:text-[2.9rem]">
              Written by people who actually bought.
            </h1>
            <p className="mt-4 max-w-2xl text-[1rem] leading-relaxed text-ink-2">
              A review can only be written by the account that placed the order, and only after the
              order was delivered. An operator reads it before it appears here. We publish no names
              and no account details — just the service, the words and the score.
            </p>
            {average !== null && (
              <p className="mt-5 flex flex-wrap items-center gap-3 text-[0.9rem] text-ink-2">
                <Stars rating={Math.round(average)} />
                <span>
                  <strong className="text-ink">{average.toFixed(1)}</strong> from{" "}
                  {reviews.length} published review{reviews.length === 1 ? "" : "s"}
                </span>
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="shell py-12">
        {reviews.length === 0 ? (
          <div className="rounded-3xl border border-line bg-white p-8 text-center">
            <h2 className="text-[1.2rem] font-semibold">No reviews published yet.</h2>
            <p className="mx-auto mt-2 max-w-xl text-[0.92rem] leading-relaxed text-ink-2">
              That is the honest state, not an empty design. Reviews appear here once a customer
              with a delivered order writes one and an operator publishes it. We do not fill this
              page with examples, quotes or borrowed testimonials.
            </p>
            <Link
              href="/login?next=%2Fdashboard%2Freviews"
              className="btn btn-primary mt-6 inline-flex"
            >
              Review an order you received
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <>
            <ul className="grid gap-4 md:grid-cols-2">
              {reviews.map((review) => (
                <li key={review.id} className="rounded-3xl border border-line bg-white p-6">
                  <div className="flex items-center justify-between gap-3">
                    <Stars rating={review.rating} />
                    <span className="text-meta text-ink-3">{formatDate(review.publishedAt)}</span>
                  </div>
                  {review.headline && (
                    <h2 className="mt-3 text-[1.02rem] font-semibold text-ink">{review.headline}</h2>
                  )}
                  <p className="mt-2 whitespace-pre-line text-[0.92rem] leading-relaxed text-ink-2">
                    {review.body}
                  </p>
                  <p className="mt-4 flex items-center gap-1.5 text-meta font-medium text-lav-700">
                    <Check className="h-3.5 w-3.5" />
                    Verified purchase · {review.productName}
                  </p>
                </li>
              ))}
            </ul>
            <div className="mt-8 rounded-3xl border border-lav-200 bg-lav-50/60 p-6 sm:flex sm:items-center sm:justify-between">
              <p className="text-[0.92rem] leading-relaxed text-ink-2">
                Bought something and have an opinion? You can review any delivered order.
              </p>
              <Link href="/login?next=%2Fdashboard%2Freviews" className="btn btn-primary mt-4 sm:mt-0">
                Write a review
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
