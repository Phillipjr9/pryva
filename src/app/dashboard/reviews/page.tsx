import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { listReviewableOrders, listUserReviews } from "@/lib/reviews";
import { ReviewForm } from "./ReviewForm";

export const metadata = { title: "Reviews" };
export const dynamic = "force-dynamic";

const STATUS_COPY: Record<string, { label: string; className: string }> = {
  pending: { label: "Waiting for a check", className: "bg-amber-50 text-amber-800 border-amber-200" },
  published: { label: "Published", className: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  rejected: { label: "Not published", className: "bg-red-50 text-red-700 border-red-200" },
};

/** Shell comes from the dashboard layout; this page supplies content only. */
export default async function DashboardReviewsPage() {
  const user = await requireUser("/dashboard/reviews");
  const [orders, reviews] = await Promise.all([
    listReviewableOrders(user.id),
    listUserReviews(user.id),
  ]);

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-[1.5rem] font-medium tracking-tight text-ink sm:text-[1.7rem]">Reviews</h1>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          Only an order that was delivered can be reviewed, once. Reviews are checked before they
          appear publicly; yours is never edited.
        </p>
      </div>

      <ReviewForm
        orders={orders.map((order) => ({
          id: order.id,
          reference: order.reference,
          productName: order.productName,
          planLabel: order.planLabel,
          service: order.service,
          status: order.status,
        }))}
      />

      <section>
        <h2 className="text-[0.95rem] font-semibold">Your reviews</h2>
        {reviews.length === 0 ? (
          <p className="mt-2 text-[0.88rem] text-ink-2">You have not written one yet.</p>
        ) : (
          <ul className="mt-3 grid gap-3">
            {reviews.map((review) => {
              const status = STATUS_COPY[review.status] ?? {
                label: review.status,
                className: "bg-slate-50 text-slate-700 border-slate-200",
              };
              return (
                <li key={review.id} className="rounded-2xl border border-line bg-white p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[0.9rem] font-semibold text-ink">
                      {review.productName}
                      <span className="ml-2 font-normal text-ink-3">{review.rating} / 5</span>
                    </span>
                    <span className={`rounded-full border px-2.5 py-1 text-micro font-semibold ${status.className}`}>
                      {status.label}
                    </span>
                  </div>
                  {review.headline && (
                    <p className="mt-2 text-[0.88rem] font-medium text-ink">{review.headline}</p>
                  )}
                  <p className="mt-1 whitespace-pre-line text-[0.88rem] leading-relaxed text-ink-2">
                    {review.body}
                  </p>
                  {review.status === "rejected" && review.moderatorNote && (
                    <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-meta text-red-700">
                      Why it was not published: {review.moderatorNote}
                    </p>
                  )}
                  {review.status === "published" && (
                    <Link
                      href="/reviews"
                      className="mt-3 inline-block text-meta font-semibold text-lav-700 hover:underline"
                    >
                      See it on the public page
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
