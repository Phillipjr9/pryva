"use client";

import { useSyncExternalStore } from "react";

import { passkeysSupported } from "@/lib/webauthn-browser";

/**
 * Whether this browser can run a WebAuthn ceremony.
 *
 * Detection has to happen after hydration — the server cannot know what browser
 * is asking — but writing the answer into state from an effect body causes a
 * cascading render (`react-hooks/set-state-in-effect`), so the answer is read
 * through `useSyncExternalStore` instead: it is a plain function of the
 * browser, it has no subscribers because it cannot change while a page is open,
 * and the server snapshot is optimistic so the control is in the markup and
 * disappears on the few browsers that cannot use it.
 */
const subscribe = () => () => {};

export function usePasskeysSupported(): boolean {
  return useSyncExternalStore(subscribe, passkeysSupported, () => true);
}
