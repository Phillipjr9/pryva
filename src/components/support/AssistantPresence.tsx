"use client";

import { useCallback, useSyncExternalStore } from "react";

import { Eye, EyeOff, Sparkle } from "@/components/icons";

/**
 * The assistant's face.
 *
 * A support page whose only sign of life is a spinner is indistinguishable from a
 * broken one, which is exactly the report that brought this here. The orb reacts
 * to what the assistant is actually doing — breathing while idle, thinking while a
 * request is in flight — so "it is working on it" is visible rather than assumed.
 *
 * Two rules keep it from becoming decoration:
 *
 *   • **It is hideable, and the choice is remembered.** Some people find a moving
 *     thing on a support screen distracting, and having to dismiss it on every
 *     visit is its own annoyance. Hidden means not rendered at all, so it stops
 *     animating and stops costing anything.
 *   • **It carries no information the text does not.** The state is also written in
 *     words next to it, and the drawing is `aria-hidden` — a screen reader hears
 *     the conversation, not a cartoon.
 */

export type PresenceState = "idle" | "thinking";

const STORAGE_KEY = "pryva:support-presence-hidden";

/**
 * The preference lives in localStorage, which is an external store — so it is read
 * as one. `getServerSnapshot` returns "visible", which is what the server rendered,
 * and React swaps in the real value after hydration without a mismatch or an extra
 * effect. Reading it into state from an effect would render twice on every visit
 * and is exactly the pattern React asks you not to write.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Another tab changing the preference should change this one too.
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readHidden(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // Private mode or a blocked store: stay visible rather than crash.
    return false;
  }
}

function serverHidden(): boolean {
  return false;
}

export function AssistantPresence({ state = "idle" }: { state?: PresenceState }) {
  const hidden = useSyncExternalStore(subscribe, readHidden, serverHidden);

  const toggle = useCallback(() => {
    const next = !readHidden();
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Preference simply does not persist; the control still works.
    }
    for (const listener of listeners) listener();
  }, []);

  if (hidden) {
    return (
      <button
        type="button"
        onClick={toggle}
        className="inline-flex items-center gap-1.5 self-start rounded-full border border-line bg-white px-3 py-1 text-micro font-semibold text-ink-2 hover:border-lav-300 hover:text-lav-800"
      >
        <Eye className="h-3.5 w-3.5" />
        Show assistant
      </button>
    );
  }

  return (
    <div
      className="flex items-center gap-3 rounded-2xl border border-lav-200 bg-lav-50/50 px-3 py-2.5"
    >
      <span className="relative grid h-14 w-14 shrink-0 place-items-center">
        {/* The drawing is decoration; the words beside it carry the state, and the
            Hide control must stay reachable, so only the SVG is hidden from AT. */}
        <svg viewBox="0 0 120 120" className="h-14 w-14" aria-hidden="true" focusable="false">
          <defs>
            <radialGradient id="pryva-orb-core" cx="38%" cy="32%" r="72%">
              <stop offset="0%" stopColor="#f5ecff" />
              <stop offset="55%" stopColor="#c4a6f2" />
              <stop offset="100%" stopColor="#7b5bbd" />
            </radialGradient>
          </defs>

          {/* Rings expand outward only while thinking: a pulse with a reason. */}
          {state === "thinking" && (
            <>
              <circle className="sp-ring" cx="60" cy="60" r="40" fill="none" stroke="#8b6bd0" strokeWidth="2" opacity="0.4" />
              <circle className="sp-ring sp-ring-2" cx="60" cy="60" r="40" fill="none" stroke="#8b6bd0" strokeWidth="2" opacity="0.25" />
            </>
          )}

          <g className={state === "thinking" ? "sp-orb-fast" : "sp-orb"}>
            <circle cx="60" cy="60" r="34" fill="url(#pryva-orb-core)" />
            <circle cx="60" cy="60" r="34" fill="none" stroke="#5a3f96" strokeWidth="1.5" opacity="0.35" />
            {/* Eyes. A slow blink is what makes a circle read as a face. */}
            <g className="sp-blink">
              <circle cx="49" cy="55" r="4.2" fill="#2b1f45" />
              <circle cx="71" cy="55" r="4.2" fill="#2b1f45" />
            </g>
            {state === "thinking" ? (
              <g>
                <circle className="sp-dot" cx="50" cy="70" r="3" fill="#2b1f45" />
                <circle className="sp-dot sp-dot-2" cx="60" cy="70" r="3" fill="#2b1f45" />
                <circle className="sp-dot sp-dot-3" cx="70" cy="70" r="3" fill="#2b1f45" />
              </g>
            ) : (
              <path
                d="M50 68q10 8 20 0"
                fill="none"
                stroke="#2b1f45"
                strokeWidth="3.2"
                strokeLinecap="round"
              />
            )}
          </g>
        </svg>
      </span>

      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-[0.86rem] font-semibold text-ink">
          <Sparkle className="h-3.5 w-3.5 text-lav-700" aria-hidden="true" />
          Pryva assistant
        </p>
        <p className="text-meta text-ink-2" aria-live="polite">
          {state === "thinking" ? "Reading your message and checking the account…" : "Here, and ready when you are."}
        </p>
      </div>

      <button
        type="button"
        onClick={toggle}
        aria-label="Hide the assistant animation"
        className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-white px-2.5 py-1 text-micro font-semibold text-ink-2 hover:border-lav-300 hover:text-lav-800"
      >
        <EyeOff className="h-3.5 w-3.5" />
        Hide
      </button>
    </div>
  );
}
