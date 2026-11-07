"use client";

import type { ComponentType, SVGProps } from "react";
import {
  Bell,
  Chat,
  Grid,
  Home,
  Inbox,
  Receipt,
  Settings,
  Star,
  Users,
  Wallet,
} from "@/components/icons";

/**
 * Icons for the dashboard's own destinations.
 *
 * These rows used to load generated 3D tiles from `/images/nav`, one PNG plus
 * three WebP derivatives per destination. They are now stroked glyphs from the
 * same 24×24 set as the buttons and headings around them, so the sidebar is one
 * visual family, ships no image bytes, and follows `currentColor` in dark mode.
 *
 * Nothing here reproduces a brand: these are Pryva's own pages. Third-party
 * products keep their real logos via `BrandIcon`.
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

type Glyph = ComponentType<SVGProps<SVGSVGElement>>;

/** One distinct glyph per destination — no row borrows another's. */
const NAV_GLYPHS: Record<NavArt, Glyph> = {
  overview: Home,
  orders: Receipt,
  wallet: Wallet,
  inbox: Inbox,
  referrals: Users,
  services: Grid,
  notifications: Bell,
  reviews: Star,
  settings: Settings,
  support: Chat,
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
 * icon, so a label here would read it twice.
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
  const Icon = NAV_GLYPHS[name];
  return <Icon width={pixelSize} height={pixelSize} className={`shrink-0 ${className}`} />;
}
