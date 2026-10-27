import type { AirtimeProvider } from "@/lib/airtime";
import { BrandIcon, type WordmarkSlug } from "@/components/BrandIcon";

/**
 * Network marks for the airtime / data pickers.
 *
 * Airtel ships an official mark (via `BrandIcon`). MTN, Glo and 9mobile publish
 * no redistributable logo, so they use the same component's wordmark tile: the
 * carrier's own wordmark in its own colours. That is deliberately NOT an
 * approximation — an earlier attempt to draw/invent these came out as a plain
 * yellow oval that looked broken. A correct wordmark always reads as the network.
 */

const WORDMARK_NETWORKS: Record<string, WordmarkSlug> = {
  mtn: "mtn",
  glo: "glo",
  "9mobile": "9mobile",
};

const NETWORK_NAMES: Record<AirtimeProvider, string> = {
  mtn: "MTN",
  airtel: "Airtel",
  glo: "Glo",
  "9mobile": "9mobile",
};

export function NetworkBadge({
  provider,
  size = 40,
  className = "",
}: {
  provider: AirtimeProvider;
  size?: number;
  className?: string;
}) {
  const wordmark = WORDMARK_NETWORKS[provider];

  if (wordmark) {
    return <BrandIcon brand={wordmark} size={size} variant="tile" className={className} />;
  }

  return <BrandIcon brand="airtel" size={size} variant="tile" className={className} />;
}

export function networkName(provider: AirtimeProvider): string {
  return NETWORK_NAMES[provider] ?? provider;
}
