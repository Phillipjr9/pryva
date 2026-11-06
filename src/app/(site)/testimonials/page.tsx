import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "@/components/icons";
import { listPublishedReviews } from "@/lib/content/reviews";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Customer feedback",
  description: "What customers say about PryvaLogs — verified reviews from real delivered orders.",
  alternates: { canonical: "/testimonials" },
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

export default async function TestimonialsPage() {
  const reviews = await listPublishedReviews(20);
  const average =
    reviews.length > 0
      ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length) * 10) / 10
      : null;

  return (
    <div className="min-h-screen bg-cream">
      <section className="py-16 sm:py-20">
        <div className="shell max-w-3xl text-center">
          <span className="eyebrow justify-center">Customer feedback</span>
          <h1 className="mt-4 text-[2.5rem] font-medium tracking-tight text-ink sm:text-[3rem]">
            What customers say
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-[1.05rem] leading-relaxed text-ink-2">
            Every review here is tied to a real delivered order. No names are published, and nothing
            is written by PryvaLogs.
          </p>
          {average !== null && (
            <p className="mt-5 flex flex-wrap items-center justify-center gap-3 text-[0.9rem] text-ink-2">
              <Stars rating={Math.round(average)} />
              <span>
                <strong className="text-ink">{average.toFixed(1)}</strong> from{" "}
                {reviews.length} published review{reviews.length === 1 ? "" : "s"}
              </span>
            </p>
          )}
        </div>
      </section>

      <section className="pb-16">
        <div className="shell">
          {reviews.length === 0 ? (
            <div className="mx-auto max-w-2xl rounded-2xl border border-line bg-white p-8 text-center">
              <h2 className="text-[1.2rem] font-semibold">No reviews published yet.</h2>
              <p className="mx-auto mt-2 max-w-xl text-[0.92rem] leading-relaxed text-ink-2">
                Reviews appear here once a customer with a delivered order writes one and an operator
                publishes it.
              </p>
              <Link href="/login?next=%2Fdashboard%2Freviews" className="btn btn-primary mt-6 inline-flex">
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
                  Bought something? You can review any delivered order from your dashboard.
                </p>
                <Link href="/login?next=%2Fdashboard%2Freviews" className="btn btn-primary mt-4 sm:mt-0">
                  Write a review
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
