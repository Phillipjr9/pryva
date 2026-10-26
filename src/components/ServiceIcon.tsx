"use client";

import Image from "next/image";

type ServiceType = "netflix" | "spotify" | "youtube" | "disney" | "chatgpt" | "canva";
type CategoryType = "streaming" | "music" | "gaming" | "productivity";

interface ServiceIconProps {
  service: ServiceType;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const serviceImages: Record<ServiceType, string> = {
  netflix: "/images/services/netflix.png",
  spotify: "/images/services/spotify.png",
  youtube: "/images/services/youtube.png",
  disney: "/images/services/disney.png",
  chatgpt: "/images/services/chatgpt.png",
  canva: "/images/services/canva.png",
};

const serviceNames: Record<ServiceType, string> = {
  netflix: "Netflix",
  spotify: "Spotify",
  youtube: "YouTube Premium",
  disney: "Disney+",
  chatgpt: "ChatGPT Plus",
  canva: "Canva Pro",
};

const sizeMap = {
  sm: 32,
  md: 48,
  lg: 64,
};

export function ServiceIcon({ service, size = "md", className = "" }: ServiceIconProps) {
  const pixelSize = sizeMap[size];

  return (
    <div className={`relative ${className}`} style={{ width: pixelSize, height: pixelSize }}>
      <Image
        src={serviceImages[service]}
        alt={serviceNames[service]}
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
