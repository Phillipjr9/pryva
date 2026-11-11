"use client";

import { useEffect, useState } from "react";
import { SiteLink as Link } from "@/components/site/SiteLink";
import { ArrowRight } from "@/components/icons";
import { formatNaira } from "@/lib/services/catalog";
import { useSiteVisitor } from "@/components/site/SiteSession";

/**
 * Phone-only sticky bar.
 *
 * It used to sit at the bottom of the homepage permanently, covering the closing
 * call to action exactly when the visitor had scrolled all the way down. Now it
 * watches that final section and gets out of the way when it is on screen.
 */
export function StickyMobileCta({
  label,
  price,
  targetId,
  href = "/signup",
  signedInHref,
}: {
  label: string;
  /**
   * Omit for a service that costs nothing. The bar then invites the visitor to
   * start free instead of naming a price — which is both true and a better
   * opening than the cheapest paid plan, since a free tool is the lowest
   * commitment on the site.
   */
  price?: number;
  targetId: string;
  href?: string;
  /**
   * Where the button goes once the visitor is known to be signed in. The page
   * this sits on is prerendered for everyone, so it cannot know that on the
   * server; `href` is what the shared markup carries.
   */
  signedInHref?: string;
}) {
  const visitor = useSiteVisitor();
  const destination = visitor && signedInHref ? signedInHref : href;
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const target = document.getElementById(targetId);
    if (!target || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => setHidden(entry.isIntersecting),
      // The bar is ~76px tall; start retreating slightly before the panel arrives.
      { rootMargin: "0px 0px -76px 0px", threshold: 0.01 },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [targetId]);

  return (
    <>
      <div
        className={`fixed inset-x-0 bottom-0 z-40 border-t border-line/80 bg-cream/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl transition-transform duration-300 lg:hidden ${
          hidden ? "translate-y-full" : "translate-y-0"
        }`}
        aria-hidden={hidden}
      >
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-meta font-semibold text-ink">
              {price === undefined ? "Start free" : <>Start with {formatNaira(price)}</>}
            </p>
            <p className="truncate text-micro text-ink-3">{label}</p>
          </div>
          <Link href={destination} className="btn btn-primary !px-5 !py-3 !text-[0.875rem]">
            Get started
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
      <div className="h-20 lg:hidden" aria-hidden="true" />
    </>
  );
}
