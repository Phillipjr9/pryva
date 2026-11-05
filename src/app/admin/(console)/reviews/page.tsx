import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { listReviewsForModeration } from "@/lib/reviews";
import { ModerationQueue } from "./ModerationQueue";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review moderation" };

const TABS = [
  { key: "pending", label: "Waiting" },
  { key: "published", label: "Published" },
  { key: "rejected", label: "Not published" },
  { key: "all", label: "All" },
] as const;

/**
 * The moderation queue.
 *
 * A review is never edited here, only published or rejected with a reason the
 * customer can read. Both decisions write an audit entry through
 *`moderateReview`, so "who refused this and why" has an answer later.
 *
 * The customer's email is on this screen and only this screen: judging a review
 * means knowing whose account wrote it, and the public page deliberately carries
 * no identity at all.
 */
export default async function AdminReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();

  const { status: requested } = await searchParams;
  const status = TABS.some((tab) => tab.key === requested) ? (requested as string) : "pending";
  const items = await listReviewsForModeration(status as "pending" | "published" | "rejected" | "all");

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[1.4rem] font-medium tracking-tight">Review moderation</h1>
          <p className="mt-1 text-[0.85rem] text-ink-2">
            Nothing on the public page without a decision here. Rejections can carry a note the
            customer will see.
          </p>
        </div>
        <Link href="/reviews" className="text-[0.8rem] font-semibold text-lav-700 hover:underline">
          See the public page
        </Link>
      </div>

      <nav className="mt-5 flex flex-wrap gap-1" aria-label="Filter reviews">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={`/admin/reviews?status=${tab.key}`}
            aria-current={status === tab.key ? "page" : undefined}
            className={
              status === tab.key
                ? "rounded-lg bg-lav-50 px-3 py-1.5 text-[0.82rem] font-medium text-lav-800"
                : "rounded-lg px-3 py-1.5 text-[0.82rem] font-medium text-ink-2 hover:bg-cream"
            }
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="mt-5">
        <ModerationQueue
          items={items.map((item) => ({
            id: item.id,
            service: item.service,
            productName: item.productName,
            rating: item.rating,
            headline: item.headline,
            body: item.body,
            status: item.status,
            createdAt: item.createdAt.toISOString(),
            customerEmail: item.customerEmail,
            moderatorNote: item.moderatorNote,
            publishedAt: item.publishedAt ? item.publishedAt.toISOString() : null,
          }))}
        />
      </div>
    </div>
  );
}
