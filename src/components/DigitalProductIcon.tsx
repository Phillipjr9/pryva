"use client";
import { useState } from "react";
import { BrandIcon } from "@/components/BrandIcon";
import { Gift } from "@/components/icons";
import { CATEGORY_ART, DIGITAL_ICON_VERSION, digitalArtwork, parseDigitalArtwork, type DigitalArtwork } from "@/lib/content/digital-artwork";

/** Fixed artwork registry only; never render a product-provided URL. */
export function DigitalProductIcon({ name, artwork, size = 44 }: { name: string; artwork?: DigitalArtwork | null; size?: number }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const art = artwork === undefined ? digitalArtwork(name) : parseDigitalArtwork(artwork);
  if (art?.kind === "brand") return <BrandIcon brand={art.key} size={size} decorative />;
  const src = art?.kind === "local"
    ? art.key === "likee" ? "/verification-logos/social-likee.png" : `/digital-brand-icons/${art.key}.png`
    : art?.kind === "indexed"
      ? `https://cdn.jsdelivr.net/npm/simple-icons@${DIGITAL_ICON_VERSION}/icons/${art.key}.svg`
    : art?.kind === "category" && Object.hasOwn(CATEGORY_ART, art.key)
    ? `/digital-artwork/${art.key}`
    : art?.kind === "simple" && ["pubg", "fortnite", "valorant", "googleplay", "itunes"].includes(art.key)
      ? `/digital-brand-icons/${art.key}.svg` : null;
  return <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-white text-ink-3" style={{ width: size, height: size }}>
    {src && failedSrc !== src ? <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedSrc(src)} className={art?.kind === "category" ? "h-full w-full object-cover" : "h-full w-full object-contain p-1"} />
    </> : <Gift width={Math.round(size * 0.5)} height={Math.round(size * 0.5)} />}
  </span>;
}
