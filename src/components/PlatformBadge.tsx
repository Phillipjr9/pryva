import { BrandIcon, type BrandIconProps } from "@/components/BrandIcon";

/**
 * Platform badge for marketplace listings (Facebook, Instagram, Gmail…).
 *
 * The marks themselves come from `BrandIcon` — real, official paths — because a
 * buyer scanning a grid of account listings recognises the actual logo, and a
 * hand-approximated one (or a generated one) looks wrong at 32px.
 *
 * This module owns the *detection*: mapping a free-text listing title like
 * "Instagram 5k followers, aged 2019" to the right mark, with a neutral
 * fallback for platforms we don't draw.
 */

export type PlatformSlug =
  | "facebook"
  | "instagram"
  | "tiktok"
  | "gmail"
  | "outlook"
  | "x"
  | "telegram"
  | "whatsapp"
  | "discord"
  | "youtube"
  | "netflix"
  | "spotify"
  | "steam"
  | "reddit"
  | "snapchat"
  | "linkedin"
  | "pinterest"
  | "apple"
  | "chatgpt"
  | "twitch"
  | "canva"
  | "threads"
  | "kick"
  | "soundcloud"
  | "generic";

const LABELS: Record<PlatformSlug, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  gmail: "Gmail",
  outlook: "Outlook",
  x: "X (Twitter)",
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  discord: "Discord",
  youtube: "YouTube",
  netflix: "Netflix",
  spotify: "Spotify",
  steam: "Steam",
  reddit: "Reddit",
  snapchat: "Snapchat",
  linkedin: "LinkedIn",
  pinterest: "Pinterest",
  apple: "Apple",
  chatgpt: "ChatGPT",
  twitch: "Twitch",
  canva: "Canva",
  threads: "Threads",
  kick: "Kick",
  soundcloud: "SoundCloud",
  generic: "Digital account",
};

/**
 * Order matters: the most specific names first, so "gmail aged" hits Gmail
 * before any generic rule, and "twitter"/"x" don't fight over the same string.
 */
const MATCHERS: Array<[PlatformSlug, RegExp]> = [
  ["facebook", /\bfacebook\b|\bfb\b|\bmeta\b/i],
  ["instagram", /\binstagram\b|\binsta\b|\big\b/i],
  ["tiktok", /\btik\s?tok\b/i],
  ["gmail", /\bgmail\b|\bgoogle mail\b/i],
  ["outlook", /\boutlook\b|\bhotmail\b|\bmsn\b/i],
  ["x", /\btwitter\b|(^|\s)x(\s|$)|\bx\.com\b/i],
  ["telegram", /\btelegram\b/i],
  ["whatsapp", /\bwhats\s?app\b/i],
  ["discord", /\bdiscord\b/i],
  ["youtube", /\byou\s?tube\b/i],
  ["netflix", /\bnetflix\b/i],
  ["spotify", /\bspotify\b/i],
  ["steam", /\bsteam\b/i],
  ["reddit", /\breddit\b/i],
  ["snapchat", /\bsnapchat\b|\bsnap\b/i],
  ["linkedin", /\blinkedin\b/i],
  ["pinterest", /\bpinterest\b/i],
  ["apple", /\bapple\b|\bicloud\b|\bapple id\b/i],
  ["chatgpt", /\bchatgpt\b|\bopenai\b|\bgpt-?4\b/i],
  ["twitch", /\btwitch\b/i],
  ["canva", /\bcanva\b/i],
  ["threads", /\bthreads\b/i],
  ["kick", /\bkick\b/i],
  ["soundcloud", /\bsoundcloud\b/i],
];

export function platformFor(...text: Array<string | null | undefined>): PlatformSlug {
  const haystack = text.filter(Boolean).join(" ");
  for (const [slug, pattern] of MATCHERS) {
    if (pattern.test(haystack)) return slug;
  }
  return "generic";
}

export function platformName(slug: PlatformSlug): string {
  return LABELS[slug];
}

function GenericMark({ size }: { size: number }) {
  return (
    <span
      role="img"
      aria-label="Digital account"
      title="Digital account"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        flex: "0 0 auto",
        borderRadius: Math.round(size * 0.28),
        background: "#F1ECFE",
        boxShadow: "inset 0 0 0 1px rgba(124,58,237,0.12)",
      }}
    >
      <svg viewBox="0 0 24 24" width={Math.round(size * 0.62)} height={Math.round(size * 0.62)} aria-hidden="true">
        <path
          fill="#7C3AED"
          d="M12 5.6a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Zm0 1.9a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6ZM5.2 19c0-2.7 3-4.5 6.8-4.5s6.8 1.8 6.8 4.5v.4H5.2V19Z"
        />
      </svg>
    </span>
  );
}

type Props = {
  platform?: PlatformSlug;
  /** Extra text used to detect the platform when `platform` is omitted. */
  detectFrom?: string | null;
  size?: number;
  className?: string;
};

export function PlatformBadge({ platform, detectFrom, size = 32, className }: Props) {
  const slug = platform ?? platformFor(detectFrom);

  if (slug === "generic") {
    return (
      <span className={className} style={{ display: "inline-flex" }}>
        <GenericMark size={size} />
      </span>
    );
  }

  return (
    <BrandIcon
      brand={slug as BrandIconProps["brand"]}
      size={size}
      variant="tile"
      className={className}
    />
  );
}

/** Small row of platform marks — used as a trust strip on the accounts page. */
export function PlatformStrip({
  platforms,
  size = 28,
  className,
}: {
  platforms: PlatformSlug[];
  size?: number;
  className?: string;
}) {
  return (
    <div className={className} style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {platforms.map((platform) => (
        <PlatformBadge key={platform} platform={platform} size={size} />
      ))}
    </div>
  );
}
