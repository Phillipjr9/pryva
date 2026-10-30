/**
 * Artwork paths for Pryva's own service and category illustrations.
 *
 * `next.config.ts` disables Next's image optimiser (`images.unoptimized: true`),
 * so a `<Image>` used to hand the browser the full 512×512 master PNG — 220–270
 * KB for a 20 px slot. `scripts/build-service-artwork.mjs` writes 64/128/192 px
 * WebP derivatives next to each master and this module builds the `srcSet`, so
 * the browser downloads the one size it needs and nothing more.
 *
 * The PNG master stays as the `src`: it is the full-resolution original and the
 * fallback for any browser that will not take a WebP.
 */

/** Widths written by the generator. Keep the two files in step. */
export const ARTWORK_WIDTHS = [64, 128, 192] as const;

export type ArtworkFolder = "services" | "categories";

/** `/images/services/email-otp-64.webp 64w, …` for a `srcSet`. */
export function artworkSrcSet(folder: ArtworkFolder, base: string): string {
  return ARTWORK_WIDTHS.map((width) => `/images/${folder}/${base}-${width}.webp ${width}w`).join(", ");
}

/** The master PNG — full resolution, and the fallback `src`. */
export function artworkMaster(folder: ArtworkFolder, base: string): string {
  return `/images/${folder}/${base}.png`;
}
