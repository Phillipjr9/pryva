"use client";

import { useEffect, useState } from "react";
import { formatNaira } from "@/lib/catalog";
import { DURATION, easeOut, prefersReducedMotion } from "@/lib/motion";

/**
 * A rands — naira amount that counts to its value instead of appearing.
 *
 * Why bother: on a funding screen the number is the entire payoff. Rendering
 * "₦30,000" straight from the server is correct and completely flat; a 600ms
 * count from the previous balance makes the credit feel like it arrived. That is
 * the one place in a money product where animation carries meaning rather than
 * decoration.
 *
 * Three rules it follows:
 * 1. The server renders the final value, so there is no layout shift, no
 *    hydration mismatch and nothing to read differently for a screen reader.
 * 2. `prefers-reduced-motion` renders the final value and never starts a frame.
 * 3. Digits are tabular, so the number does not jitter as it counts.
 * 4. A value only counts the first time it is shown. Without this, a
 *    `router.refresh()` (or any remount) restarts the ramp from zero, which on a
 *    receipt looks like the payment failed and then re-succeeded.
 */
const alreadyAnimated = new Set<string>();
export function AnimatedAmount({
  value,
  className = "",
  duration = DURATION.deliberate,
  from,
  prefixSign = false,
  /** Identity for "only animate once". Defaults to the rendered value. */
  animateKey,
}: {
  value: number;
  className?: string;
  duration?: number;
  /** Where to count from. Defaults to 0 for a credit, `value` for a static render. */
  from?: number;
  /** Show a leading + for credits. */
  prefixSign?: boolean;
  animateKey?: string;
}) {
  const [shown, setShown] = useState(value);

  useEffect(() => {
    const key = `${animateKey ?? ""}:${value}`;

    // Final value, no frames: reduced motion asks for that, and a value that has
    // already counted once must not count again after a refresh or remount.
    if (prefersReducedMotion() || alreadyAnimated.has(key)) {
      setShown(value);
      return;
    }

    const start = from ?? 0;
    if (start === value) {
      setShown(value);
      return;
    }

    let raf = 0;
    const began = performance.now();
    setShown(start);

    const tick = (now: number) => {
      const progress = Math.min(1, (now - began) / duration);
      setShown(Math.round(start + (value - start) * easeOut(progress)));
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        // Only claim the value once it actually finished: an interrupted run
        // (React's development double-invoke cancels the first frame) leaves the
        // key out, so the next mount animates properly instead of freezing.
        alreadyAnimated.add(key);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, from, animateKey]);

  return (
    <span className={`tabular-nums ${className}`.trim()} aria-label={formatNaira(value)}>
      {prefixSign && value > 0 ? "+" : ""}
      {formatNaira(shown)}
    </span>
  );
}
