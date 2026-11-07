"use client";

import { User } from "@/components/icons";

/**
 * The profile picture.
 *
 * The account has no photo upload. This used to render one of four generated 3D
 * characters; those are gone along with the rest of the 3D set. It now draws the
 * same flat `User` glyph as the rest of the interface, on a tinted circle.
 *
 * The tint is **derived from the account, not random**: the same address always
 * gets the same colour, it is identical on the server and the client (no
 * hydration mismatch, no flicker), and two people in the same room are still
 * distinguishable. It is a drawing of nobody — no photograph is implied, and
 * nothing here is a claim about the person behind the account.
 */
export const AVATAR_COUNT = 4;

/**
 * Stable 1-based avatar number for an account.
 *
 * Deliberately not cryptographic: this only picks a tint, and a simple
 * deterministic hash keeps it identical everywhere (tests included) without
 * pulling a digest into the client bundle.
 */
export function avatarNumberFor(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return (hash % AVATAR_COUNT) + 1;
}

/** Flat fills, all readable behind the lavender glyph. */
const TINTS: ReadonlyArray<{ background: string; foreground: string }> = [
  { background: "#EFE7FB", foreground: "#6B4FAE" },
  { background: "#E3EEFD", foreground: "#2F5DA8" },
  { background: "#FDEBDD", foreground: "#A65A2A" },
  { background: "#E2F3EA", foreground: "#2E7250" },
];

export function ProfileAvatar({
  seed,
  size = 36,
  className = "",
}: {
  /** Something stable and per-account — the email in every call site today. */
  seed: string;
  size?: number;
  className?: string;
}) {
  const tint = TINTS[avatarNumberFor(seed) - 1];
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-full ring-1 ring-black/5 ${className}`}
      style={{ width: size, height: size, background: tint.background, color: tint.foreground }}
    >
      <User width={Math.round(size * 0.58)} height={Math.round(size * 0.58)} />
    </span>
  );
}
