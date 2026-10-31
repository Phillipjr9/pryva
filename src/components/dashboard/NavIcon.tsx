"use client";

import { artworkMaster, artworkSrcSet } from "@/lib/service-artwork";

/**
 * Image icons for the dashboard's own destinations.
 *
 * Every row in the dashboard sidebar is a picture now, not a mixture of pictures
 * and line glyphs. The twelve service rows already carried 3D artwork; the ten
 * account and navigation rows (Overview, Orders, Wallet, Inbox, Referrals, All
 * services, Notifications, Reviews, Settings, Support) drew 16 px stroked SVGs,
 * so on the rendered page half the list looked like a different product. The
 * owner called that out: "real images icon that's missing".
 *
 * These are Pryva's own destinations, so the tiles are generated 3D objects in
 * the same lavender/indigo/peach set as `public/images/services` — no brand mark
 * is reproduced here, and nothing is borrowed from another row. The same
 * `artwork:*` pipeline writes the 64/128/192 WebP derivatives, so a 20 px sidebar
 * row downloads the 64 px copy rather than the 300 KB master.
 */
export type NavArt =
  | "overview"
  | "orders"
  | "wallet"
  | "inbox"
  | "referrals"
  | "services"
  | "notifications"
  | "reviews"
  | "settings"
  | "support";

const NAV_ART: Record<NavArt, string> = {
  overview: "overview",
  orders: "orders",
  wallet: "wallet",
  inbox: "inbox",
  referrals: "referrals",
  services: "services",
  notifications: "notifications",
  reviews: "reviews",
  settings: "settings",
  support: "support",
};

export const NAV_ART_LABELS: Record<NavArt, string> = {
  overview: "Overview",
  orders: "Orders",
  wallet: "Wallet",
  inbox: "Temporary inbox",
  referrals: "Refer and earn",
  services: "All services",
  notifications: "Notifications",
  reviews: "Reviews",
  settings: "Settings",
  support: "Support",
};

const sizeMap = { xs: 20, sm: 24, md: 32 } as const;

/**
 * Always decorative: every call site puts the destination's name next to the
 * picture, so an alt text here would read the label twice.
 */
export function NavIcon({
  name,
  size = "xs",
  className = "",
}: {
  name: NavArt;
  size?: keyof typeof sizeMap;
  className?: string;
}) {
  const pixelSize = sizeMap[size];
  const art = NAV_ART[name];
  return (
    // A plain <img>: the optimiser is off, and the srcSet is the point — a 20 px
    // slot should take the 64 px derivative, not the master.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={artworkMaster("nav", art)}
      srcSet={artworkSrcSet("nav", art)}
      sizes={`${pixelSize}px`}
      width={pixelSize}
      height={pixelSize}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      className={`shrink-0 rounded-[5px] object-cover ${className}`}
    />
  );
}
