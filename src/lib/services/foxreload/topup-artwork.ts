import "server-only";
import { digitalArtwork, type CategoryArt, type DigitalArtwork } from "@/lib/content/digital-artwork";

/**
 * Reviewed top-up category IDs from the provider's public category tree.
 * The product often belongs to a regional leaf called only "Global", so a
 * single page can contain identically named denominations from different games.
 * Keep this lookup server-side, bounded and explicit: never trust a requested
 * category, denomination or image URL as the product's identity.
 *
 * If the provider changes its hierarchy, an unknown ID simply uses the existing
 * name/slug recognizer. New entries require reviewing the leaf and its parent.
 */
const TOPUP_CATEGORY_ART: Readonly<Record<string, CategoryArt>> = {
  // 8 Ball Pool
  "019e9cf1-b2af-7b70-8517-43bc87345192": "8-ball-pool",
  "019e9cf1-b2ba-7a43-ae4f-e04ad8450667": "8-ball-pool",
  // Oxide: Survival Island
  "019e9cf4-df78-7483-8efd-33624962c54a": "oxide-survival-island",
  "019e9cf4-df7e-7822-ba2f-a354d1961549": "oxide-survival-island",
  // Acecraft
  "019e9cf1-b359-71d0-aeaa-ec2f985da217": "acecraft",
  "019e9cf1-b35e-7780-8b01-5070fbd34b2a": "acecraft",
  // Ace Racer (Global and regional leaves)
  "019e9cf1-b3e7-7772-85c2-bab08b6721d0": "ace-racer",
  "019e9cf1-b3ee-7471-9197-e6e25ba5cd33": "ace-racer",
  "019e9cfe-75d1-71f2-ae82-35bc3d4d7ee0": "ace-racer",
  "019fcfbe-0d4c-71d0-8814-473591b2d35c": "ace-racer",
  "019e9cfe-7893-72a1-88b5-31c4bd1d42a0": "ace-racer",
  "019e9cfe-76df-7202-8fbd-3a7ae3036de8": "ace-racer",
  "019e9cfe-7b7a-7070-8e60-4d0b0c208c5b": "ace-racer",
  "019e9cfe-778c-7c80-a4d9-08aee387dfe3": "ace-racer",
  // AFK Journey
  "019e9cf1-b425-7703-81a2-00fba07662e0": "afk-journey",
  "019e9cf1-b429-7152-aae4-ddd59cb5e450": "afk-journey",
  // Age of Empires Mobile
  "019e9cf1-b473-7323-ba72-51229d69ca4a": "age-of-empires-mobile",
  "019e9cf1-b477-7df3-a19a-0ca038fc4336": "age-of-empires-mobile",
  // Age of Magic
  "019e9cf1-b518-7af3-aaf5-16f877a30bbf": "age-of-magic",
  "019e9cf1-b51e-7590-a976-6c4aa939559e": "age-of-magic",
};

function sameArtwork(a: DigitalArtwork, b: DigitalArtwork): boolean {
  return a.kind === b.kind && a.key === b.key;
}

/** Return only a curated key. Neither category IDs nor provider URLs leave here. */
export function topupArtwork(name: string, slug: string | undefined, categoryId: unknown, deliveryType: unknown): DigitalArtwork | null {
  const usual = digitalArtwork(name, slug);
  if (deliveryType !== "direct_topup") return usual;

  const named = digitalArtwork(name);
  const slugged = slug ? digitalArtwork("", slug) : null;
  // When two independently recognizable identities conflict, do not guess.
  if (named && slugged && !sameArtwork(named, slugged)) return null;

  const key = typeof categoryId === "string" && Object.hasOwn(TOPUP_CATEGORY_ART, categoryId)
    ? TOPUP_CATEGORY_ART[categoryId] : null;
  if (!key) return usual;

  // Gift cards and top-ups can have different owners. A category alone is not
  // enough to assign a game mark to an explicitly named gift card/voucher.
  if (/\bgift\s*(?:card|voucher)\b/i.test(name)) return null;
  const categoryArt: DigitalArtwork = { kind: "category", key };
  if ((named && !sameArtwork(named, categoryArt)) || (slugged && !sameArtwork(slugged, categoryArt))) return null;
  return categoryArt;
}
