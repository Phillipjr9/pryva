import type { ReactNode } from "react";
import { SiteHeader } from "@/components/site/SiteHeader";
import { SiteFooter } from "@/components/site/SiteFooter";
import { CookieConsentBanner } from "@/components/site/CookieConsentBanner";
import { SiteSessionProvider } from "@/components/site/SiteSession";

/**
 * The public shell is prerendered and shared between visitors.
 *
 * Nothing in this layout may read the request — no `cookies()`, no `headers()`,
 * no `getCurrentUser()`. One such read here makes every page under `(site)` a
 * per-request render, which is what it used to be: the header looked up the
 * session, so the homepage could not be cached and a traffic spike landed on the
 * application instead of the edge. Who the visitor is gets answered in the
 * browser by `SiteSessionProvider`.
 *
 * ## Why `revalidate`, and why five minutes
 *
 * Several of these pages print what is configured — the homepage's "Ordering
 * configured · N of M plans" line, for one — and that comes from environment
 * variables.
 * A page prerendered with no expiry would keep whatever the build saw until the
 * next deployment; `/accounts` was bitten by exactly that once and is rendered
 * per request for it. A short expiry is the middle ground: the page is rebuilt
 * in the background at most once per window, by one request, and everyone else
 * is served the cached copy. Five minutes bounds how stale a configuration line
 * can be without turning a busy hour into a rebuild per visitor.
 *
 * The value must stay a literal number: Next reads it statically. Pages that
 * export `dynamic = "force-dynamic"` are unaffected and still render per request.
 */
export const revalidate = 300;

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <SiteSessionProvider>
      <div className="relative flex min-h-screen flex-col overflow-x-clip">
        <div className="pointer-events-none fixed inset-0 -z-10">
          <div className="absolute left-1/2 top-[-18rem] h-[38rem] w-[52rem] -translate-x-1/2 rounded-full bg-lav-200/35 blur-[130px]" />
          <div className="absolute right-[-10rem] top-[30rem] h-[26rem] w-[26rem] rounded-full bg-peach/40 blur-[120px]" />
        </div>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
        <CookieConsentBanner />
      </div>
    </SiteSessionProvider>
  );
}
