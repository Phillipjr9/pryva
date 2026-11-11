"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { SiteLink as Link } from "@/components/site/SiteLink";

/**
 * The signed-in visitor, as the public pages know them.
 *
 * ## Why the browser asks, instead of the server knowing
 *
 * A page that reads the session cookie while it renders cannot be shared between
 * visitors, so it cannot be prerendered or served from the edge cache: every
 * view is a function invocation. The public shell used to do exactly that, for
 * the sake of two header buttons. This module moves the question to the browser:
 * the HTML is the same for everyone and is rendered once, and the few places
 * that differ for a signed-in visitor correct themselves after one small request
 * to `/api/visitor`.
 *
 * ## What a visitor sees
 *
 * The prerendered markup is the signed-out version, which is right for nearly
 * everyone who lands on a marketing page. A signed-in visitor sees it for the
 * moment the request takes and then gets their dashboard button and wallet
 * balance. Nothing here is a security boundary — every link it changes points at
 * a page that enforces sign-in itself — so the worst a failed request can do is
 * leave the signed-out links in place, and those still work: `/login` forwards
 * an already signed-in visitor to where they were going.
 */
export type SiteVisitor = { name: string; walletBalance: number };

const SESSION_ENDPOINT = "/api/visitor";

const SiteVisitorContext = createContext<SiteVisitor | null>(null);

/** Trust nothing about the shape: this is parsed from a network response. */
export function parseSiteVisitor(payload: unknown): SiteVisitor | null {
  if (!payload || typeof payload !== "object") return null;
  const user = (payload as { user?: unknown }).user;
  if (!user || typeof user !== "object") return null;
  const { name, walletBalance } = user as { name?: unknown; walletBalance?: unknown };
  if (typeof name !== "string" || typeof walletBalance !== "number" || !Number.isFinite(walletBalance)) {
    return null;
  }
  return { name, walletBalance };
}

export function SiteSessionProvider({ children }: { children: ReactNode }) {
  const [visitor, setVisitor] = useState<SiteVisitor | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    const load = async () => {
      try {
        const response = await fetch(SESSION_ENDPOINT, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) return;
        const next = parseSiteVisitor(await response.json());
        if (!controller.signal.aborted) setVisitor(next);
      } catch {
        // Offline, aborted, or the endpoint is busy. The signed-out markup that
        // is already on screen is correct for a visitor nobody could identify.
      }
    };

    void load();

    // A page restored from the back/forward cache keeps its old state, so a
    // visitor who signed out and pressed Back would still see their balance.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void load();
    };
    window.addEventListener("pageshow", onPageShow);

    return () => {
      controller.abort();
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  return <SiteVisitorContext.Provider value={visitor}>{children}</SiteVisitorContext.Provider>;
}

/** `null` until the visitor is known to be signed in — including while asking. */
export function useSiteVisitor(): SiteVisitor | null {
  return useContext(SiteVisitorContext);
}

/**
 * A link whose destination depends on whether the visitor is signed in.
 *
 * `href` is what the prerendered page contains and what a signed-out visitor
 * follows; `signedInHref` replaces it once the visitor is known. Both must be
 * safe for either visitor, because the swap happens after the page is shown.
 */
export function VisitorLink({
  href,
  signedInHref,
  className,
  children,
}: {
  href: string;
  signedInHref: string;
  className?: string;
  children: ReactNode;
}) {
  const visitor = useSiteVisitor();
  return (
    <Link href={visitor ? signedInHref : href} className={className}>
      {children}
    </Link>
  );
}

/** A short piece of wording that differs for a signed-in visitor. */
export function VisitorText({ signedOut, signedIn }: { signedOut: string; signedIn: string }) {
  const visitor = useSiteVisitor();
  return <>{visitor ? signedIn : signedOut}</>;
}
