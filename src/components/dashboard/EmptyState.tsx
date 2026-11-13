import Link from "next/link";

/**
 * One empty state for the whole dashboard. Before this, each page invented its
 * own padding, headline size and CTA, so an empty Orders page and an empty
 * Wallet page looked like different products.
 */
export function EmptyState({
  title,
  body,
  action,
  secondary,
  className = "",
}: {
  title: string;
  body: string;
  /**
   * Either a link or an in-page action. A dead-end CTA is worse than none: the
   * withdrawal screen used to point at `#bank-accounts` before that panel existed
   * in the DOM, so "Add a bank account" did nothing for a brand-new customer.
   */
  action?: { label: string; href?: string; onClick?: () => void };
  secondary?: { label: string; href: string };
  className?: string;
}) {
  return (
    <div
      className={`rounded-[1.5rem] border border-dashed border-line bg-[#fffdfa] px-6 py-9 text-center ${className}`}
    >
      <p className="text-[1rem] font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-[0.8125rem] leading-relaxed text-ink-2">{body}</p>
      {(action || secondary) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {action && (action.onClick ? (
            <button
              type="button"
              onClick={action.onClick}
              className="btn btn-primary !px-4 !py-2.5 !text-[0.8125rem] sm:!text-[0.8125rem]"
            >
              {action.label}
            </button>
          ) : (
            <Link
              href={action.href ?? "#"}
              className="btn btn-primary !px-4 !py-2.5 !text-[0.8125rem] sm:!text-[0.8125rem]"
            >
              {action.label}
            </Link>
          ))}
          {secondary && (
            <Link
              href={secondary.href}
              className="text-meta font-semibold text-lav-700 hover:underline"
            >
              {secondary.label}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
