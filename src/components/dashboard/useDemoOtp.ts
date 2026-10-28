"use client";

import { useEffect, useState } from "react";

/** Polls a preview-only, same-origin endpoint; the server owns the demo code. */
export function useDemoOtp(orderId: string, enabled: boolean, initialCode: string | null) {
  const [code, setCode] = useState(initialCode);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!enabled || code) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    async function check() {
      let delay = 4000;
      try {
        const response = await fetch(`/api/demo/orders/${encodeURIComponent(orderId)}/delivery`, {
          method: "POST", cache: "no-store", signal: controller.signal,
        });
        const data = await response.json() as { ok?: boolean; simulated?: boolean; otpCode?: string | null; waiting?: boolean };
        if (cancelled) return;
        if (!response.ok || !data.ok || !data.simulated) {
          setRetrying(true);
          delay = 10000;
        } else {
          setRetrying(false);
          if (data.otpCode) {
            setCode(data.otpCode);
            return;
          }
          if (!data.waiting) return;
        }
      } catch {
        if (cancelled) return;
        setRetrying(true);
        delay = 10000;
      }
      if (!cancelled) timer = setTimeout(check, delay);
    }

    void check();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [orderId, enabled, code]);

  return { code, retrying, resetCode: () => setCode(null) };
}

/** A demo campaign advances on the same preview-only delivery endpoint. */
export function useDemoPromotion(orderId: string, enabled: boolean) {
  const [finished, setFinished] = useState(false);
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    if (!enabled || finished) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    async function check() {
      let delay = 4000;
      try {
        const response = await fetch(`/api/demo/orders/${encodeURIComponent(orderId)}/delivery`, { method: "POST", cache: "no-store", signal: controller.signal });
        const data = await response.json() as { ok?: boolean; simulated?: boolean; status?: string; waiting?: boolean };
        if (cancelled) return;
        if (!response.ok || !data.ok || !data.simulated) { setRetrying(true); delay = 10000; }
        else {
          setRetrying(false);
          if (data.status === "delivered") { setFinished(true); return; }
          if (!data.waiting) return;
        }
      } catch {
        if (cancelled) return;
        setRetrying(true);
        delay = 10000;
      }
      if (!cancelled) timer = setTimeout(check, delay);
    }
    void check();
    return () => { cancelled = true; controller.abort(); if (timer) clearTimeout(timer); };
  }, [orderId, enabled, finished]);
  return { finished, retrying };
}
