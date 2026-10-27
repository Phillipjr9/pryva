"use client";

import Image from "next/image";

type DigitalServiceType = "netflix" | "spotify" | "youtube" | "disney" | "chatgpt" | "canva";
type CoreServiceType = "numbers" | "esim" | "proxies" | "email-otp";
type AdditionalServiceType = "data" | "gift-cards" | "bulk" | "scheduled";
type ServiceType = DigitalServiceType | CoreServiceType | AdditionalServiceType;
type CategoryType = "streaming" | "music" | "gaming" | "productivity";

interface ServiceIconProps {
  service: ServiceType;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const digitalServiceImages: Record<DigitalServiceType, string> = {
  netflix: "/images/services/netflix.png",
  spotify: "/images/services/spotify.png",
  youtube: "/images/services/youtube.png",
  disney: "/images/services/disney.png",
  chatgpt: "/images/services/chatgpt.png",
  canva: "/images/services/canva.png",
};

const coreServiceImages: Record<CoreServiceType, string> = {
  numbers: "/images/services/virtual-numbers.png",
  esim: "/images/services/esim.png",
  proxies: "/images/services/proxies.png",
  "email-otp": "/images/services/email-otp.png",
};

const additionalServiceImages: Record<AdditionalServiceType, string> = {
  data: "/images/services/data.png",
  "gift-cards": "/images/services/gift-cards.png",
  bulk: "/images/services/bulk.png",
  scheduled: "/images/services/scheduled.png",
};

const serviceImages: Record<ServiceType, string> = {
  ...digitalServiceImages,
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
  data: "Data Plans",
  "gift-cards": "Gift Cards",
  bulk: "Bulk Orders",
  scheduled: "Scheduled Purchases",
};

const sizeMap = {
  sm: 32,
  md: 48,
  lg: 64,
};

export function ServiceIcon({ service, size = "md", className = "" }: ServiceIconProps) {
  const pixelSize = sizeMap[size];
  const imageSrc = serviceImages[service] || FALLBACK_IMAGE;
  const altText = serviceNames[service] || service;

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
  size?: "sm" | "md" | "lg";
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
