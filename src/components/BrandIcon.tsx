import { BRAND_MARKS, type BrandSlug } from "@/lib/brand-marks";

/**
 * BrandIcon renders a real, official brand mark — not generated artwork.
 *
 * Two looks:
 *  - `tile` (default): the mark reversed out of a tile in the brand's own colour,
 *    the way Netflix, Spotify and friends appear on a store listing.
 *  - `bare`: the mark straight onto the page in its brand colour, for tight rows.
 *
 * Marks whose artwork carries its own multicolour fills (Instagram, Canva,
 * ChatGPT, Google) are always drawn as-is on a light tile — painting them a
 * single colour would destroy the logo.
 */

/** Marks whose paths carry their own colours — never overpaint these. */
const SELF_COLOURED = new Set<BrandSlug>(["instagram", "canva", "chatgpt", "google"]);

/** Brands drawn in their own colour on a WHITE tile (a white mark would vanish). */
const COLOUR_ON_LIGHT = new Set<BrandSlug>(["gmail"]);

/**
 * Brands that publish no redistributable mark. Rather than invent a logo for
 * them, the tile carries the product wordmark in the brand's colours — honest,
 * instantly readable, and impossible to mistake for the official lockup.
 */
export const WORDMARK_BRANDS = {
  "disney-plus": { label: "Disney+", title: "Disney+", hex: "#0E1C6B", accent: "#3E5BDB", text: "#ffffff" },
  outlook: { label: "Outlook", title: "Microsoft Outlook", hex: "#0F6CBD", accent: "#28A8EA", text: "#ffffff" },
  // Nigerian carriers with no redistributable logo: the wordmark in the brand's
  // own colours. Their real logos ARE wordmarks, so this reads correctly.
  mtn: { label: "MTN", title: "MTN", hex: "#FFCC00", accent: "#FFE066", text: "#111111" },
  glo: { label: "glo", title: "Glo", hex: "#00A651", accent: "#4CD08A", text: "#ffffff" },
  "9mobile": { label: "9mobile", title: "9mobile", hex: "#006B3F", accent: "#16A06A", text: "#ffffff" },
} as const;

export type WordmarkSlug = keyof typeof WORDMARK_BRANDS;

export type BrandIconProps = {
  brand: BrandSlug | WordmarkSlug;
  size?: number;
  variant?: "tile" | "bare";
  className?: string;
  /** Set when the surrounding copy already names the brand. */
  decorative?: boolean;
};

export function BrandIcon({
  brand,
  size = 40,
  variant = "tile",
  className,
  decorative = false,
}: BrandIconProps) {
  const wordmark = (WORDMARK_BRANDS as Record<string, (typeof WORDMARK_BRANDS)[WordmarkSlug]>)[brand];
  if (wordmark) {
    return (
      <span
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : wordmark.title}
        aria-hidden={decorative ? true : undefined}
        title={decorative ? undefined : wordmark.title}
        className={className}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          flex: "0 0 auto",
          borderRadius: variant === "tile" ? Math.round(size * 0.28) : 0,
          background: variant === "tile" ? `linear-gradient(135deg, ${wordmark.accent} 0%, ${wordmark.hex} 100%)` : "transparent",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            color: variant === "tile" ? wordmark.text ?? "#ffffff" : wordmark.hex,
            fontSize: Math.max(8, Math.round(size * (wordmark.label.length >= 6 ? 0.24 : wordmark.label.length >= 4 ? 0.28 : 0.34))),
            fontWeight: 700,
            letterSpacing: "-0.02em",
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}
        >
          {wordmark.label}
        </span>
      </span>
    );
  }

  const mark = BRAND_MARKS[brand as BrandSlug];
  if (!mark) return null;

  const selfColoured = SELF_COLOURED.has(brand as BrandSlug);
  const tray = variant === "tile";
  const radius = Math.round(size * 0.28);
  const colourOnLight = COLOUR_ON_LIGHT.has(brand as BrandSlug);
  const lightTile = isLightColor(mark.hex);
  const fill = selfColoured
    ? undefined
    : tray
      ? colourOnLight
        ? mark.hex || "#111827"
        : lightTile
          ? "#111827"
          : "#ffffff"
      : mark.hex || "#111827";

  return (
    <span
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : mark.title}
      aria-hidden={decorative ? true : undefined}
      title={decorative ? undefined : mark.title}
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        flex: "0 0 auto",
        borderRadius: tray ? radius : 0,
        background: tray ? (selfColoured || colourOnLight ? "#ffffff" : mark.hex || "#ffffff") : "transparent",
        boxShadow:
          tray && (selfColoured || colourOnLight || !mark.hex)
            ? "inset 0 0 0 1px rgba(15,23,42,0.08)"
            : undefined,
        overflow: "hidden",
      }}
    >
      <svg
        viewBox={mark.viewBox}
        width={Math.round(size * (tray ? 0.62 : 0.9))}
        height={Math.round(size * (tray ? 0.62 : 0.9))}
        aria-hidden="true"
        focusable="false"
        style={{ display: "block" }}
      >
        <g
          // Static path data generated from open icon sets (see src/lib/brand-marks.ts).
          dangerouslySetInnerHTML={{ __html: mark.body }}
          fill={fill}
        />
      </svg>
    </span>
  );
}

/**
 * Yellow and lime marks (Snapchat, Binance) disappear as white-on-brand. The
 * official tiles draw those glyphs in black, so mirror that instead of guessing.
 */
function isLightColor(hex: string): boolean {
  const value = hex.replace("#", "");
  if (value.length !== 6) return false;
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return luminance > 0.55;
}

/** Convenience: does this slug have a real mark? */
export function hasBrandMark(slug: string): slug is BrandSlug {
  return Object.prototype.hasOwnProperty.call(BRAND_MARKS, slug);
}
