"use client";

import { useEffect } from "react";

/**
 * Reloads a tab that is running an older build than the server.
 *
 * Without it, a tab left open across a deploy hydrates new server markup with
 * old client JavaScript: React throws a hydration mismatch, and interactions
 * whose handlers live in the old bundle (the demo login button was one) appear
 * to do nothing. One cheap request on mount and whenever the tab is refocused
 * is enough to catch it.
 */
export function VersionGuard({ buildId }: { buildId: string }) {
  useEffect(() => {
    let cancelled = false;
    let checking = false;

    async function check() {
      if (checking || document.visibilityState === "hidden") return;
      checking = true;
      try {
        const response = await fetch("/api/version", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { build?: string };
        if (cancelled || !data.build || data.build === buildId) return;

        // Two independent brakes so a strange deployment can never ping-pong a
        // tab: remember the build we already reloaded for, and cap the number of
        // version reloads per browser session.
        const buildKey = "pryva:reloaded-for";
        const countKey = "pryva:version-reloads";
        if (window.sessionStorage.getItem(buildKey) === data.build) return;
        const reloads = Number(window.sessionStorage.getItem(countKey) ?? "0");
        if (reloads >= 2) return;
        window.sessionStorage.setItem(buildKey, data.build);
        window.sessionStorage.setItem(countKey, String(reloads + 1));
        window.location.reload();
      } catch {
        /* offline or blocked — the page still works */
      } finally {
        checking = false;
      }
    }

    void check();

    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void check();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [buildId]);

  return null;
}
