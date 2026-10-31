"use client";

import { artworkMaster, artworkSrcSet } from "@/lib/service-artwork";

/**
 * The profile picture.
 *
 * The account has no photo upload, and the sidebar used to show the customer's
 * initials in a gradient circle — a placeholder that looks unfinished next to
 * twelve 3D service tiles. This renders one of four 3D avatar illustrations in
 * the same set instead.
 *
 * The choice is **derived from the account, not random**: the same address always
 * gets the same avatar, it is identical on the server and the client (no
 * hydration mismatch, no flicker), and two people in the same room see different
 * pictures. It is a drawing of nobody — no photograph is implied, and nothing
 * here is a claim about the person behind the account.
 */
export const AVATAR_COUNT = 4;

/**
 * Stable 1-based avatar number for an account.
 *
 * Deliberately not cryptographic: this only picks a picture, and a simple
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
  const art = `avatar-${avatarNumberFor(seed)}`;
  return (
    // Plain <img> for the same reason as the service tiles: the optimiser is off,
    // and the srcSet is what keeps a 36 px circle to a 64 px file.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={artworkMaster("avatars", art)}
      srcSet={artworkSrcSet("avatars", art)}
      sizes={`${size}px`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      className={`shrink-0 rounded-full bg-lav-100 object-cover ring-1 ring-black/5 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
