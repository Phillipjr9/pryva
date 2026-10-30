"use client";

import Image from "next/image";
import { BrandIcon, type BrandIconProps } from "@/components/BrandIcon";

type DigitalServiceType = "netflix" | "spotify" | "youtube" | "disney" | "chatgpt" | "canva";
type CoreServiceType = "numbers" | "esim" | "proxies" | "email-otp";
type AdditionalServiceType = "data" | "gift-cards" | "bulk" | "scheduled" | "accounts";
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
 * Digital products are *third-party brands*, so they show their real logo
 * (`BrandIcon`) — a hand-drawn Netflix tile reads as Netflix at 20px in a way a
 * generated illustration never can. Pryva's own catalogue below keeps the 3D
 * artwork, because there is no "real" logo for "virtual numbers" — and the
 * marks it could claim (Gmail, Outlook, the carriers) belong to services the
 * customer brings, not to the Pryva product being described. `STATUS.md` §17
 * records the audited list of which surface shows what, and why.
 */
const digitalServiceBrands: Record<DigitalServiceType, BrandIconProps["brand"]> = {
  netflix: "netflix",
  spotify: "spotify",
  youtube: "youtube",
  disney: "disney-plus",
  chatgpt: "chatgpt",
  canva: "canva",
};

const coreServiceImages: Record<CoreServiceType, string> = {
  numbers: "/images/services/virtual-numbers.png",
  esim: "/images/services/esim.png",
  proxies: "/images/services/proxies.png",
  "email-otp": "/images/services/email-otp.png",
};

const additionalServiceImages: Record<AdditionalServiceType, string> = {
  accounts: "/images/services/digital-accounts.png",
  data: "/images/services/data.png",
  "gift-cards": "/images/services/gift-cards.png",
  bulk: "/images/services/bulk.png",
  scheduled: "/images/services/scheduled.png",
};

const serviceImages: Record<Exclude<ServiceType, DigitalServiceType>, string> = {
  ...coreServiceImages,
  ...additionalServiceImages,
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
};

const sizeMap = {
  xs: 20,
  sm: 32,
  md: 48,
  lg: 64,
};

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

  const imageSrc = (serviceImages as Record<string, string | undefined>)[service];
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
  if (!imageSrc) {
    if (process.env.NODE_ENV !== "production") {
      console.error(`ServiceIcon: no artwork mapped for "${service}"`);
    }
    return (
      <div
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : altText}
        aria-hidden={decorative ? true : undefined}
        title={decorative ? undefined : altText}
        className={`flex items-center justify-center rounded-lg bg-lav-100 text-lav-700 ${className}`}
        style={{ width: pixelSize, height: pixelSize }}
      >
        <svg viewBox="0 0 24 24" width={Math.round(pixelSize * 0.55)} height={Math.round(pixelSize * 0.55)} aria-hidden="true">
          <path fill="currentColor" d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13Zm2 .5v12h12V6H6Z" />
        </svg>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`} style={{ width: pixelSize, height: pixelSize }}>
      <Image
        src={imageSrc}
        alt={altText}
        width={pixelSize}
        height={pixelSize}
        className="rounded-lg object-cover"
      />
    </div>
  );
}

interface CategoryIconProps {
  category: CategoryType;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

const categoryImages: Record<CategoryType, string> = {
  streaming: "/images/categories/streaming.png",
  music: "/images/categories/music.png",
  gaming: "/images/categories/gaming.png",
  productivity: "/images/categories/productivity.png",
};

const categoryNames: Record<CategoryType, string> = {
  streaming: "Streaming",
  music: "Music",
  gaming: "Gaming",
  productivity: "Productivity",
};

export function CategoryIcon({ category, size = "md", className = "" }: CategoryIconProps) {
  const pixelSize = sizeMap[size];

  return (
    <div className={`relative ${className}`} style={{ width: pixelSize, height: pixelSize }}>
      <Image
        src={categoryImages[category]}
        alt={categoryNames[category]}
        width={pixelSize}
        height={pixelSize}
        className="rounded-lg object-cover"
      />
    </div>
  );
}

export function getServiceName(service: ServiceType): string {
  return serviceNames[service];
}

export function getCategoryName(category: CategoryType): string {
  return categoryNames[category];
}
