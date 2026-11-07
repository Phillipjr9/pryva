"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Script from "next/script";

/**
 * The Cloudflare Turnstile widget for public signup.
 *
 * Rendered explicitly rather than by class-name scan: the auth card mounts and
 * unmounts as the visitor moves between sign-in, sign-up and the 2FA step, and
 * an implicit scan would either miss the new node or render two widgets into it.
 *
 * A token is single-use and expires after a few minutes, so every path that
 * ends a token's life — expiry, Cloudflare error, a refused submit — reports
 * `null` back to the form. The form blocks its own submit while the token is
 * null, which is what stops a visitor posting a spent token and reading a
 * confusing server error instead of a fresh challenge.
 */

type TurnstileApi = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback": () => void;
      "expired-callback": () => void;
      "timeout-callback": () => void;
      theme?: "light" | "dark" | "auto";
      size?: "normal" | "flexible" | "compact";
      language?: string;
    },
  ) => string | undefined;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export function TurnstileWidget({
  siteKey,
  onToken,
  resetSignal = 0,
}: {
  siteKey: string;
  /** Called with the token, or null whenever there is no usable token. */
  onToken: (token: string | null) => void;
  /** Increment to force a fresh challenge after a refused submit. */
  resetSignal?: number;
}) {
  const slot = useRef<HTMLDivElement | null>(null);
  const widgetId = useRef<string | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  // The callback identity changes on every parent render; keeping it in a ref
  // means the widget is rendered once rather than re-created on every keystroke.
  const report = useRef(onToken);
  useEffect(() => { report.current = onToken; }, [onToken]);

  const render = useCallback(() => {
    const api = window.turnstile;
    const element = slot.current;
    if (!api || !element || widgetId.current !== undefined) return;
    try {
      widgetId.current = api.render(element, {
        sitekey: siteKey,
        theme: "light",
        size: "flexible",
        callback: (token) => { setFailed(false); report.current(token); },
        "error-callback": () => { setFailed(true); report.current(null); },
        "expired-callback": () => report.current(null),
        "timeout-callback": () => report.current(null),
      });
    } catch {
      // Reported to the form rather than kept as local state: this runs from the
      // mount effect as well as from the script's load event, and an effect must
      // not set state synchronously. The form blocks its submit on a null token,
      // so a provider that cannot even render is still not a way through.
      report.current(null);
    }
  }, [siteKey]);

  /*
   * The script may already be cached and executed before this mounts, and in
   * that case `next/script` returns early without calling `onLoad` at all
   * (`loadScript` bails on `LoadCache.has(src)`). Coming back to /signup from
   * another page is exactly that case, so the widget is also rendered from here.
   */
  useEffect(() => {
    if (window.turnstile) render();
  }, [render]);

  useEffect(() => {
    if (resetSignal === 0) return;
    const api = window.turnstile;
    if (!api || widgetId.current === undefined) return;
    report.current(null);
    try { api.reset(widgetId.current); } catch { /* a removed widget needs no reset */ }
  }, [resetSignal]);

  // Leaving the card must not leave a widget bound to a detached node.
  useEffect(() => () => {
    const api = window.turnstile;
    if (api && widgetId.current !== undefined) {
      try { api.remove(widgetId.current); } catch { /* already gone */ }
      widgetId.current = undefined;
    }
  }, []);

  return (
    <div className="grid gap-1.5">
      <Script
        src={SCRIPT_SRC}
        strategy="afterInteractive"
        onLoad={render}
        onError={() => { setFailed(true); report.current(null); }}
      />
      {/* The reserved height is the widget's own, so the card does not jump as
          the challenge appears. No "loading" label: Turnstile draws its own
          placeholder, and a second one behind a transparent iframe would show
          through it. */}
      <div ref={slot} aria-live="polite" className="min-h-[65px]" />
      {failed && (
        <p role="alert" className="text-meta font-medium text-rose-700">
          The verification check could not load. Please refresh the page, or disable a script blocker
          for this site and try again.
        </p>
      )}
    </div>
  );
}
