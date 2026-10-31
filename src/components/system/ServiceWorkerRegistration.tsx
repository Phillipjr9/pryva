"use client";

import { useEffect } from "react";

/**
 * Registers the service worker — in production only.
 *
 * A worker in development would cache the dev server's assets and outlive the
 * edit that changed them, which is the same class of confusion `BuildGuard`
 * exists to catch. It is also delayed: installation competes with the first
 * paint, and a wallet's landing page should not wait on a cache warm-up.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const timer = window.setTimeout(() => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Installability is a convenience; failing to register must not surface
        // as an error to someone trying to check their balance.
      });
    }, 2_000);

    return () => window.clearTimeout(timer);
  }, []);

  return null;
}
