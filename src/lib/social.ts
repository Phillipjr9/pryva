/**
 * Our social accounts.
 *
 * ## Why some of these links go to the platform, not to us
 *
 * The owner asked for the platforms to be visible now, while the TikTok and X
 * profiles are still being created. A footer icon that points at a profile that
 * does not exist is a dead link, and a footer icon that points nowhere is a lie,
 * so the compromise is explicit and temporary:
 *
 *   * `profileUrl` is the real account, and the link uses it the moment it is set;
 *   * until then the link goes to the platform's own home page, and the label says
 *     "coming soon" to anyone hovering or using a screen reader.
 *
 * The distinction is in the data structure, not in a comment somebody will miss:
 * `socialIsPlaceholder()` is the single place that decides, and a test checks that
 * every link has one of the two destinations and a brand mark that exists.
 *
 * ## Replacing a placeholder
 *
 * Set `profileUrl` for the platform. Nothing else changes: the footer, the label
 * and the `rel` are already wired. Delete the entry to remove it from the page.
 */

import type { BrandSlug } from "@/lib/brand-marks";

export type SocialLink = {
  id: "x" | "tiktok";
  /** Shown to a screen reader and in the tooltip. */
  label: string;
  /** Slug in `BRAND_MARKS` — real marks from the extractor, never drawn by hand. */
  mark: BrandSlug;
  /** The account, once it exists. */
  profileUrl: string | null;
  /** Where the link goes in the meantime: the platform itself. */
  platformUrl: string;
};

export const SOCIAL_LINKS: SocialLink[] = [
  {
    id: "x",
    label: "X",
    mark: "x",
    profileUrl: null,
    platformUrl: "https://x.com",
  },
  {
    id: "tiktok",
    label: "TikTok",
    mark: "tiktok",
    profileUrl: null,
    platformUrl: "https://www.tiktok.com",
  },
];

/** The real profile when there is one, the platform's home page until then. */
export function socialHref(link: SocialLink): string {
  return link.profileUrl ?? link.platformUrl;
}

/** True while the link points at the platform rather than at our account. */
export function socialIsPlaceholder(link: SocialLink): boolean {
  return !link.profileUrl;
}

/** What a screen reader hears, and what the hover text says. */
export function socialLabel(link: SocialLink): string {
  return socialIsPlaceholder(link)
    ? `Pryva on ${link.label} — profile coming soon`
    : `Pryva on ${link.label}`;
}
