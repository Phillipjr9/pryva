import type { AirtimeProvider } from "@/lib/airtime";
import { BrandIcon, type BrandIconProps } from "@/components/BrandIcon";

/**
 * Network marks for the airtime / data pickers.
 *
 * Airtel ships an official mark (via `BrandIcon`). MTN, Glo and 9mobile publish
 * no redistributable logo, so they use the same component's wordmark tile: the
 * carrier's own wordmark in its own colours. That is deliberately NOT an
 * approximation — an earlier attempt to draw/invent these came out as a plain
 * yellow oval that looked broken. A correct wordmark always reads as the network.
 */

/**
 * One entry per provider, exhaustive by type.
 *
 * This used to be a `Record<string, WordmarkSlug>` plus a final
 * `return <BrandIcon brand="airtel" …>`, so ANY provider without a wordmark
 * entry rendered Airtel's logo. There are exactly four providers today, which
 * hid the bug; the moment a fifth appeared the picker would have shown a rival
 * network's mark for it. The map below cannot miss a provider — adding one to
 * `AirtimeProvider` fails typecheck until it is given its own mark here.
 */
const NETWORK_BRANDS: Record<AirtimeProvider, BrandIconProps["brand"]> = {
  // MTN, Glo and 9mobile publish no redistributable mark, so they get the
  // wordmark tile in their own colours (see WORDMARK_BRANDS in BrandIcon).
  mtn: "mtn",
  airtel: "airtel",
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
  const brand = (NETWORK_BRANDS as Record<string, BrandIconProps["brand"] | undefined>)[provider];

  if (!brand) {
    // Never substitute another network's mark. A neutral tile that names the
    // provider is honest; a rival's logo is a lie with a trademark on it.
    return (
      <span
        role="img"
        aria-label={networkName(provider)}
        title={networkName(provider)}
        className={`inline-flex items-center justify-center rounded-lg bg-lav-100 text-meta font-semibold text-lav-700 ${className}`}
        style={{ width: size, height: size, flex: "0 0 auto" }}
      >
        {networkName(provider).slice(0, 3)}
      </span>
    );
  }

  return <BrandIcon brand={brand} size={size} variant="tile" className={className} />;
}

export function networkName(provider: AirtimeProvider): string {
  return NETWORK_NAMES[provider] ?? provider;
}
