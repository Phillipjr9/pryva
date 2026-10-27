"use client";

import Image from "next/image";
import { BrandIcon, type BrandIconProps } from "@/components/BrandIcon";

type DigitalServiceType = "netflix" | "spotify" | "youtube" | "disney" | "chatgpt" | "canva";
type CoreServiceType = "numbers" | "esim" | "proxies" | "email-otp";
type AdditionalServiceType = "data" | "gift-cards" | "bulk" | "scheduled" | "accounts";
type ServiceType = DigitalServiceType | CoreServiceType | AdditionalServiceType;
type CategoryType = "streaming" | "music" | "gaming" | "productivity";

interface ServiceIconProps {
  service: ServiceType;
  size?: "xs" | "sm" | "md" | "lg";
  className?: string;
}

/**
 * Digital products are *third-party brands*, so they show their real logo
 * (`BrandIcon`) — a hand-drawn Netflix tile reads as Netflix at 20px in a way a
 * generated illustration never can. Pryva's own catalogue below keeps the 3D
 * artwork, because there is no "real" logo for "virtual numbers".
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

// Fallback image for unknown services
const FALLBACK_IMAGE = "/images/services/virtual-numbers.png";

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

export function ServiceIcon({ service, size = "md", className = "" }: ServiceIconProps) {
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

  const imageSrc = serviceImages[service as Exclude<ServiceType, DigitalServiceType>];
  const altText = serviceNames[service] || service;

  // Use fallback if imageSrc is undefined, null, or empty string
  const finalImageSrc = imageSrc && imageSrc.length > 0 ? imageSrc : FALLBACK_IMAGE;

  return (
    <div className={`relative ${className}`} style={{ width: pixelSize, height: pixelSize }}>
      <Image
        src={finalImageSrc}
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
