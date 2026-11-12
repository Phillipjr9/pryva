"use client";

import { useEffect, useState } from "react";

/** Re-render when a response's cooldown expires; clean up on navigation. */
export function useRetryCooldown(retryAt: number): boolean {
  const [expiredAt, setExpiredAt] = useState(0);
  useEffect(() => {
    if (!retryAt) return;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      const remaining = retryAt - Date.now();
      if (remaining <= 0) setExpiredAt(retryAt);
      else timer = setTimeout(check, Math.min(remaining, 2_147_483_647));
    };
    timer = setTimeout(check, Math.max(0, Math.min(retryAt - Date.now(), 2_147_483_647)));
    return () => clearTimeout(timer);
  }, [retryAt]);
  return retryAt > 0 && expiredAt !== retryAt;
}
