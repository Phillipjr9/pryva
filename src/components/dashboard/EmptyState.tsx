import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "@/components/icons";

/**
 * One empty state for the whole dashboard. Before this, each page invented its
 * own padding, headline size and CTA, so an empty Orders page and an empty
 * Wallet page looked like different products.
 */
export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
  secondary,
  className = "",
}: {
  icon: (props: { className?: string }) => ReactNode;
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
      <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-lav-50 text-lav-700">
        <Icon className="h-5 w-5" />
      </span>
      <p className="mt-3.5 text-[1rem] font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-[0.82rem] leading-relaxed text-ink-2">{body}</p>
      {(action || secondary) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {action && (action.onClick ? (
            <button
              type="button"
              onClick={action.onClick}
              className="btn btn-primary !px-4 !py-2.5 !text-[0.8125rem] sm:!text-[0.78rem]"
            >
              {action.label}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <Link
              href={action.href ?? "#"}
              className="btn btn-primary !px-4 !py-2.5 !text-[0.8125rem] sm:!text-[0.78rem]"
            >
              {action.label}
              <ArrowRight className="h-3.5 w-3.5" />
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
