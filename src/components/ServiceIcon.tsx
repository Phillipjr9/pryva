"use client";

import type { ComponentType, SVGProps } from "react";
import { BrandIcon, type BrandIconProps } from "@/components/BrandIcon";
import {
  Calendar,
  Gamepad,
  Gift,
  Globe,
  IdCard,
  Layers,
  Mail,
  Megaphone,
  MonitorPlay,
  Music,
  Phone,
  Refresh,
  ShieldCheck,
  Signal,
  Sim,
  BarChart3,
} from "@/components/icons";

type DigitalServiceType = "netflix" | "spotify" | "youtube" | "disney" | "chatgpt" | "canva";
type CoreServiceType = "numbers" | "esim" | "proxies" | "email-otp";
type AdditionalServiceType =
  | "data"
  | "gift-cards"
  | "bulk"
  | "scheduled"
  | "accounts"
  // Categories, not catalogue slugs: they are the two ways to buy a
  // third-party platform's service, and the subscription shelf. Each needed a
  // mark of its own so no sidebar row borrows another one's artwork.
  | "subscriptions"
  | "app-verification"
  | "social-promotion";
export type ServiceType = DigitalServiceType | CoreServiceType | AdditionalServiceType;
type CategoryType = "streaming" | "music" | "gaming" | "productivity";

interface ServiceIconProps {
  service: ServiceType;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  /** Set when the surrounding text already names the service. */
  decorative?: boolean;
}

/**
 * Two kinds of thing, two kinds of mark.
 *
 * Third-party products are *brands*, so they show the real logo (`BrandIcon`,
 * path data from the official open icon sets). Netflix, Spotify, Canva and the
 * rest are never drawn by hand and never generated.
 *
 * Pryva's own catalogue — virtual numbers, eSIM, proxies, an inbox — has no
 * official logo to reproduce, so it is drawn from the same stroked 24×24 set as
 * the rest of the interface (`@/components/icons`). It used to be a shelf of
 * generated 3D renders; those are gone. A flat glyph stays legible at 20 px,
 * costs no bytes over the wire, inherits `currentColor`, and cannot fall out of
 * step with the icons beside it.
 *
 * The mapping and the customer-facing surfaces are pinned by
 * src/test/service-logos.test.tsx.
 */
const digitalServiceBrands: Record<DigitalServiceType, BrandIconProps["brand"]> = {
  netflix: "netflix",
  spotify: "spotify",
  youtube: "youtube",
  disney: "disney-plus",
  chatgpt: "chatgpt",
  canva: "canva",
};

type Glyph = ComponentType<SVGProps<SVGSVGElement>>;

/** One flat glyph per Pryva product. No two share one. */
const serviceGlyphs: Record<CoreServiceType | AdditionalServiceType, Glyph> = {
  numbers: Phone,
  esim: Sim,
  proxies: Globe,
  "email-otp": Mail,
  accounts: IdCard,
  data: Signal,
  "gift-cards": Gift,
  bulk: Layers,
  scheduled: Calendar,
  subscriptions: Refresh,
  "app-verification": ShieldCheck,
  "social-promotion": Megaphone,
};

const serviceNames: Record<ServiceType, string> = {
  netflix: "Netflix",
  spotify: "Spotify",
  youtube: "YouTube Premium",
  disney: "Disney+",
  chatgpt: "ChatGPT Plus",
  canva: "Canva Pro",
  numbers: "Virtual Numbers",
  esim: "eSIM Data",
  proxies: "Residential Proxies",
  "email-otp": "Email OTP",
  accounts: "Digital Accounts",
  data: "Data Plans",
  "gift-cards": "Gift Cards",
  bulk: "Bulk Orders",
  scheduled: "Scheduled Purchases",
  subscriptions: "Subscriptions",
  "app-verification": "App Verification",
  "social-promotion": "Social Promotion",
};

const sizeMap = {
  xs: 20,
  sm: 32,
  md: 48,
  lg: 64,
};

/**
 * The tile every Pryva glyph sits in.
 *
 * Kept at the same outer box as the old artwork so no layout moved when the
 * pictures came out: a rounded lavender square, the glyph at 55% of the slot.
 * `currentColor` means it follows the surrounding text in dark mode instead of
 * staying a bright rectangle.
 */
function GlyphTile({
  glyph: Icon,
  label,
  pixelSize,
  className,
  decorative,
}: {
  glyph: Glyph;
  label: string;
  pixelSize: number;
  className: string;
  decorative: boolean;
}) {
  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      title={decorative ? undefined : label}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg bg-lav-100 text-lav-700 ${className}`}
      style={{ width: pixelSize, height: pixelSize }}
    >
      <Icon width={Math.round(pixelSize * 0.55)} height={Math.round(pixelSize * 0.55)} />
    </span>
  );
}

export function ServiceIcon({ service, size = "md", className = "", decorative = false }: ServiceIconProps) {
  const pixelSize = sizeMap[size];

  if (service in digitalServiceBrands) {
    return (
      <BrandIcon
        brand={digitalServiceBrands[service as DigitalServiceType]}
        size={pixelSize}
        variant="tile"
        decorative={false}
        className={className}
      />
    );
  }

  const Icon = (serviceGlyphs as Record<string, Glyph | undefined>)[service];
  const altText = decorative ? "" : serviceNames[service] || service;

  /*
   * There used to be a `FALLBACK_IMAGE` here pointing at the virtual-numbers
   * artwork. That meant a misspelled or unmapped slug silently drew ANOTHER
   * service's logo, which is worse than drawing nothing: the customer sees a
   * number icon on the e-mail page and nobody notices for months. Every key
   * below is exhaustive at compile time, so this branch is unreachable unless
   * a call site casts past the type — and if it does, the honest answer is a
   * neutral tile that claims nothing rather than a wrong brand.
   */
  if (!Icon) {
    if (process.env.NODE_ENV !== "production") {
      console.error(`ServiceIcon: no glyph mapped for "${service}"`);
    }
    return (
      <span
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : altText}
        aria-hidden={decorative ? true : undefined}
        title={decorative ? undefined : altText}
        className={`inline-flex shrink-0 items-center justify-center rounded-lg bg-lav-100 text-lav-700 ${className}`}
        style={{ width: pixelSize, height: pixelSize }}
      >
        <svg viewBox="0 0 24 24" width={Math.round(pixelSize * 0.55)} height={Math.round(pixelSize * 0.55)} aria-hidden="true">
          <path fill="currentColor" d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13Zm2 .5v12h12V6H6Z" />
        </svg>
      </span>
    );
  }

  return (
    <GlyphTile
      glyph={Icon}
      label={altText}
      pixelSize={pixelSize}
      className={className}
      decorative={decorative}
    />
  );
}

interface CategoryIconProps {
  category: CategoryType;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
  /** Set when the surrounding text already names the category. */
  decorative?: boolean;
}

const categoryGlyphs: Record<CategoryType, Glyph> = {
  streaming: MonitorPlay,
  music: Music,
  gaming: Gamepad,
  productivity: BarChart3,
};

const categoryNames: Record<CategoryType, string> = {
  streaming: "Streaming",
  music: "Music",
  gaming: "Gaming",
  productivity: "Productivity",
};

export function CategoryIcon({ category, size = "md", className = "", decorative = false }: CategoryIconProps) {
  return (
    <GlyphTile
      glyph={categoryGlyphs[category]}
      label={categoryNames[category]}
      pixelSize={sizeMap[size]}
      className={className}
      decorative={decorative}
    />
  );
}

export function getServiceName(service: ServiceType): string {
  return serviceNames[service];
}

export function getCategoryName(category: CategoryType): string {
  return categoryNames[category];
}
