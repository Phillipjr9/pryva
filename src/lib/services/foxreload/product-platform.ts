import "server-only";
import { namedDigitalProduct } from "@/lib/services/digital-product-names";

/**
 * Separately reviewed product identities for denomination-only top-ups. These
 * are independent of artwork: changing an icon must not change the filter.
 * Unknown or conflicting categories/names/slug prefixes are left unlabelled.
 * Provider IDs and slugs are never returned to the browser.
 */
const REVIEWED_TOPUP_CATEGORIES: Readonly<Record<string, string>> = {
  "019e9cf1-b2af-7b70-8517-43bc87345192": "8 Ball Pool",
  "019e9cf1-b2ba-7a43-ae4f-e04ad8450667": "8 Ball Pool",
  "019e9cf4-df78-7483-8efd-33624962c54a": "Oxide: Survival Island",
  "019e9cf4-df7e-7822-ba2f-a354d1961549": "Oxide: Survival Island",
  "019e9cf1-b359-71d0-aeaa-ec2f985da217": "Acecraft",
  "019e9cf1-b35e-7780-8b01-5070fbd34b2a": "Acecraft",
  "019e9cf1-b3e7-7772-85c2-bab08b6721d0": "Ace Racer",
  "019e9cf1-b3ee-7471-9197-e6e25ba5cd33": "Ace Racer",
  "019e9cfe-75d1-71f2-ae82-35bc3d4d7ee0": "Ace Racer",
  "019fcfbe-0d4c-71d0-8814-473591b2d35c": "Ace Racer",
  "019e9cfe-7893-72a1-88b5-31c4bd1d42a0": "Ace Racer",
  "019e9cfe-76df-7202-8fbd-3a7ae3036de8": "Ace Racer",
  "019e9cfe-7b7a-7070-8e60-4d0b0c208c5b": "Ace Racer",
  "019e9cfe-778c-7c80-a4d9-08aee387dfe3": "Ace Racer",
  "019e9cf1-b425-7703-81a2-00fba07662e0": "AFK Journey",
  "019e9cf1-b429-7152-aae4-ddd59cb5e450": "AFK Journey",
  "019e9cf1-b473-7323-ba72-51229d69ca4a": "Age of Empires Mobile",
  "019e9cf1-b477-7df3-a19a-0ca038fc4336": "Age of Empires Mobile",
  "019e9cf1-b518-7af3-aaf5-16f877a30bbf": "Age of Magic",
  "019e9cf1-b51e-7590-a976-6c4aa939559e": "Age of Magic",
};

// Prefixes are explicit game names, with a boundary so a similar longer slug
// cannot accidentally acquire another game's identity.
const KNOWN_GAMES: ReadonlyArray<{ label: string; name: RegExp; slug: RegExp }> = [
  { label: "Call of Duty Mobile", name: /^call[ -]of[ -]duty[ :\-]*mobile\b/i, slug: /^call-of-duty-mobile(?:-|$)/i },
  { label: "8 Ball Pool", name: /^8[ -]ball[ -]pool\b/i, slug: /^8-ball-pool(?:-|$)/i },
  { label: "Oxide: Survival Island", name: /^oxide[ :\-]+survival[ -]island\b/i, slug: /^oxide-survival-island(?:-|$)/i },
  { label: "Acecraft", name: /^acecraft\b/i, slug: /^acecraft(?:-|$)/i },
  { label: "Ace Racer", name: /^ace[ -]racer\b/i, slug: /^ace-racer(?:-|$)/i },
  { label: "AFK Journey", name: /^afk[ -]journey\b/i, slug: /^afk-journey(?:-|$)/i },
  { label: "Age of Empires Mobile", name: /^age[ -]of[ -]empires?[ -]mobile\b/i, slug: /^age-of-empires-mobile(?:-|$)/i },
  { label: "Age of Magic", name: /^age[ -]of[ -]magic\b/i, slug: /^age-of-magic(?:-|$)/i },
  { label: "Mobile Legends", name: /^mobile[ -]legends\b/i, slug: /^mobile-legends(?:-|$)/i },
  { label: "Free Fire", name: /^free[ -]fire\b/i, slug: /^free-fire(?:-|$)/i },
  { label: "PUBG", name: /^pubg\b/i, slug: /^pubg(?:-|$)/i },
  { label: "Fortnite", name: /^fortnite\b/i, slug: /^fortnite(?:-|$)/i },
  { label: "Valorant", name: /^valorant\b/i, slug: /^valorant(?:-|$)/i },
  { label: "Roblox", name: /^roblox\b/i, slug: /^roblox(?:-|$)/i },
];

export function reviewedTopupPlatform(name: string, slug: unknown, categoryId: unknown, deliveryType: unknown): string | null {
  if (deliveryType !== "direct_topup" || /\bgift\s*(?:card|voucher|code)\b/i.test(name)) return null;
  const category = typeof categoryId === "string" && Object.hasOwn(REVIEWED_TOPUP_CATEGORIES, categoryId)
    ? REVIEWED_TOPUP_CATEGORIES[categoryId] : null;
  const slugName = typeof slug === "string" && slug.length <= 256 ? KNOWN_GAMES.find((entry) => entry.slug.test(slug.trim()))?.label ?? null : null;
  const titleName = KNOWN_GAMES.find((entry) => entry.name.test(name.trim()))?.label ?? namedDigitalProduct(name);
  const identities = new Set([category, slugName, titleName].filter((value): value is string => !!value));
  if (identities.size > 1) return null;
  // A title already names the product. This extra field is for an independently
  // reviewed category or explicit provider slug, not a guess from an amount.
  return category ?? slugName;
}
