/**
 * Motion, in one place.
 *
 * Ported from Veyra's system, where the same three questions kept being answered
 * differently in different files: how long a change takes, what curve it uses,
 * and whether the visitor asked for movement at all. A payment screen is the
 * worst place to guess — a 700ms curve on a balance that just changed reads as a
 * glitch, and a 120ms one reads as a jump cut.
 *
 * The numbers below are chosen for money: short enough that the new balance
 * arrives while the eye is still on it, long enough to be seen as a transition
 * rather than a redraw.
 */
export const DURATION = {
  /** Hover, press, icon swaps. */
  instant: 120,
  /** A value changing in place — counters, chips, tabs. */
  quick: 220,
  /** A card or panel entering. */
  base: 380,
  /** The paying steps; each one has to be readable. */
  deliberate: 620,
} as const;

export const EASE = {
  /** Default: fast out, settled in. Matches --ease in globals.css. */
  out: "cubic-bezier(0.22, 1, 0.36, 1)",
  /** Symmetric, for things that grow from a point. */
  inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
  /** A spring feel without shipping a spring library. */
  spring: "cubic-bezier(0.34, 1.42, 0.64, 1)",
} as const;

export const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Ease-out numeric ramp. `t` is 0..1 progress, returns 0..1 eased progress.
 * Used by the counters so a changing balance settles instead of stopping dead.
 */
export function easeOut(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
}
