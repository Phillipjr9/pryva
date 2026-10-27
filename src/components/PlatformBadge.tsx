/**
 * PlatformBadge — hand-authored SVG marks for third-party platforms.
 *
 * Why hand-authored: AI image models invent trademarks (an AI "MTN" came back as
 * a plain yellow oval), and shipping a wrong logo on a marketplace page both looks
 * broken and invites a trademark complaint. Every mark here is drawn from simple
 * geometry in the platform's real brand colours. No generated art, no
 * third-party logo package (simple-icons is not a dependency).
 *
 * These marks are used for identification only — nominative use — never as a
 * claim of partnership. Keep that framing if the copy around them changes.
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
  | "generic";

const TILE: Record<PlatformSlug, string> = {
  facebook: "#1877F2",
  instagram: "linear-gradient(145deg, #FDCA52 0%, #F4477B 42%, #C32AA3 72%, #4F5BD5 100%)",
  tiktok: "#010101",
  gmail: "#FFFFFF",
  outlook: "#0F6CBD",
  x: "#0F1419",
  telegram: "#2AABEE",
  whatsapp: "#25D366",
  discord: "#5865F2",
  youtube: "#FF0033",
  netflix: "#141414",
  spotify: "#1DB954",
  steam: "#1B2838",
  generic: "#EDE9FE",
};

function Mark({ slug }: { slug: PlatformSlug }) {
  switch (slug) {
    case "facebook":
      return (
        <path
          fill="#FFFFFF"
          d="M13.6 21v-6.9h2.32l.35-2.7H13.6V9.68c0-.78.22-1.31 1.34-1.31h1.43V5.96c-.25-.03-1.1-.11-2.1-.11-2.08 0-3.5 1.27-3.5 3.6v2.0H8.44v2.7h2.33V21h2.83Z"
        />
      );
    case "instagram":
      return (
        <>
          <rect x="5.4" y="5.4" width="13.2" height="13.2" rx="4" fill="none" stroke="#FFFFFF" strokeWidth="1.8" />
          <circle cx="12" cy="12" r="3.1" fill="none" stroke="#FFFFFF" strokeWidth="1.8" />
          <circle cx="16.5" cy="7.6" r="1.15" fill="#FFFFFF" />
        </>
      );
    case "tiktok":
      return (
        <>
          <path
            fill="#FFFFFF"
            d="M14.1 5h2.05c.18 1.55 1.06 2.7 2.6 2.93v2.06a5.6 5.6 0 0 1-2.6-.77v5.36c0 2.72-1.75 4.42-4.16 4.42A3.94 3.94 0 0 1 8 15.06c0-2.35 1.72-3.94 4.05-3.94.3 0 .55.03.8.08v2.16a2.2 2.2 0 0 0-.72-.12c-1.15 0-2 .78-2 1.9 0 1.13.85 1.9 2 1.9 1.3 0 2.05-.84 2.05-2.26V5Z"
          />
          <path fill="#25F4EE" opacity="0.85" d="M13.1 5h.7v10.7c0 1.05-.5 1.62-1.35 1.62-.4 0-.75-.14-.98-.38l-.5 1.9c.42.24.94.38 1.55.38 1.5 0 2.4-1 2.4-2.62V5Z" />
        </>
      );
    case "gmail":
      return (
        <>
          <rect x="3" y="6" width="18" height="12" rx="2.4" fill="#FFFFFF" stroke="#E7E1F7" strokeWidth="0.6" />
          {/* Gmail's red envelope "M" — the one shape everyone recognises. */}
          <path
            fill="none"
            stroke="#EA4335"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4.9 17.4V9.3l7.1 4.9 7.1-4.9v8.1"
          />
          <path fill="#EA4335" d="M4.9 8.3 7.2 6.6h9.6l2.3 1.7-7.1 4.9-7.1-4.9Z" opacity="0.16" />
        </>
      );
    case "outlook":
      return (
        <>
          <rect x="11.4" y="7.4" width="9.2" height="9.2" rx="1.1" fill="#FFFFFF" opacity="0.9" />
          <path fill="#0F6CBD" d="M11.4 8.6 16 12l4.6-3.4v1.5L16 13.6l-4.6-3.5V8.6Z" />
          <rect x="3.2" y="5.9" width="9.6" height="12.2" rx="1.6" fill="#0F6CBD" />
          <ellipse cx="8" cy="12" rx="2.7" ry="3" fill="none" stroke="#FFFFFF" strokeWidth="1.7" />
        </>
      );
    case "x":
      return (
        <path
          fill="#FFFFFF"
          d="M16.9 5h2.2l-4.8 5.5 5.65 7.5h-4.42l-3.46-4.53L7.86 18H5.64l5.15-5.88L5.4 5.35h4.53l3.13 4.14L16.9 5Zm-.78 11.75h1.22L8.9 6.18H7.6l8.52 10.57Z"
        />
      );
    case "telegram":
      return (
        <path
          fill="#FFFFFF"
          d="M17.9 7.3 15.7 17c-.17.74-.6.92-1.22.57l-3.36-2.48-1.62 1.56c-.18.18-.33.33-.68.33l.24-3.42 6.23-5.63c.27-.24-.06-.37-.42-.14l-7.7 4.85-3.31-1.04c-.72-.22-.73-.72.15-1.06l12.95-4.99c.6-.22 1.13.14.94 1.08Z"
        />
      );
    case "whatsapp":
      return (
        <>
          <path
            fill="#FFFFFF"
            d="M12 5.2a6.7 6.7 0 0 0-5.7 10.2L5.3 18.8l3.5-.92A6.7 6.7 0 1 0 12 5.2Zm0 1.6a5.1 5.1 0 1 1-2.6 9.5l-.3-.18-2.05.54.55-2-.2-.31A5.1 5.1 0 0 1 12 6.8Z"
          />
          <path
            fill="#FFFFFF"
            d="M9.9 9.1c.15 0 .3 0 .42.32l.55 1.3c.06.14.1.3.02.45l-.32.47c-.09.13-.18.26-.08.45.1.19.45.75 1 1.24.7.62 1.24.83 1.44.93.19.1.3.08.42-.05l.5-.58c.14-.16.27-.12.44-.06l1.3.62c.2.1.33.14.38.22.05.08.05.47-.12.9-.17.44-.98.86-1.35.9-.36.05-.73.13-2.1-.44-1.63-.68-2.65-2.34-2.73-2.45-.08-.1-.63-.85-.63-1.62 0-.77.4-1.15.55-1.31.14-.16.3-.2.42-.2Z"
          />
        </>
      );
    case "discord":
      return (
        <path
          fill="#FFFFFF"
          d="M17.6 7.9a12 12 0 0 0-3-.94l-.24.48a9.2 9.2 0 0 0-4.72 0l-.25-.48a12 12 0 0 0-3 .94C4.3 11.2 3.7 14.4 4 17.6a12.2 12.2 0 0 0 3.7 1.87l.75-1.2c-.4-.15-.79-.33-1.15-.55l.28-.22a8.6 8.6 0 0 0 8.84 0l.28.22c-.37.22-.76.4-1.16.55l.76 1.2c1.33-.46 2.58-1.1 3.68-1.87.36-3.6-.6-6.76-2.38-9.7ZM9.7 15.3c-.72 0-1.32-.66-1.32-1.47 0-.8.58-1.47 1.32-1.47.74 0 1.34.67 1.32 1.47 0 .81-.58 1.47-1.32 1.47Zm4.6 0c-.72 0-1.32-.66-1.32-1.47 0-.8.58-1.47 1.32-1.47.74 0 1.34.67 1.32 1.47 0 .81-.58 1.47-1.32 1.47Z"
        />
      );
    case "youtube":
      return (
        <path fill="#FFFFFF" d="M10.2 9.1v5.8l5-2.9-5-2.9Z" />
      );
    case "netflix":
      return (
        <path
          fill="#E50914"
          d="M8.2 5h2.5l3.1 8.9V5h2.2v14h-2.4L10.4 9.7V19H8.2V5Z"
        />
      );
    case "spotify":
      return (
        <>
          <path fill="none" stroke="#FFFFFF" strokeWidth="1.9" strokeLinecap="round" d="M7.2 9.2c3.2-1 6.5-.7 9.4.9" />
          <path fill="none" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" d="M7.8 12.1c2.6-.8 5.3-.55 7.7.75" />
          <path fill="none" stroke="#FFFFFF" strokeWidth="1.7" strokeLinecap="round" d="M8.3 14.9c2-.62 4.1-.42 6 .6" />
        </>
      );
    case "steam":
      return (
        <>
          <circle cx="12" cy="12" r="6.4" fill="none" stroke="#C7D5E0" strokeWidth="1.5" />
          <circle cx="14.4" cy="9.8" r="2.1" fill="#C7D5E0" />
          <circle cx="14.4" cy="9.8" r="0.85" fill="#1B2838" />
          <path fill="none" stroke="#C7D5E0" strokeWidth="1.6" strokeLinecap="round" d="M12.6 11.3 9.4 14.4" />
          <circle cx="8.5" cy="15.2" r="1.7" fill="none" stroke="#C7D5E0" strokeWidth="1.5" />
        </>
      );
    default:
      return (
        <path
          fill="#7C3AED"
          d="M12 6.6c-3.3 0-6 2.5-6 5.6 0 2.3 1.5 4.3 3.6 5.1l.5-1.7c-1.2-.6-2-1.8-2-3.2 0-2 1.7-3.6 3.9-3.6s3.9 1.6 3.9 3.6c0 1.4-.9 2.7-2.1 3.2l.5 1.7c2.2-.8 3.7-2.8 3.7-5.1 0-3.1-2.7-5.6-6-5.6Z"
        />
      );
  }
}

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
  generic: "Digital account",
};

/**
 * Map free-text listing/category titles to a platform mark.
 * Order matters: longer / more specific names first so "gmail aged" hits Gmail
 * before the generic rule, and "twitter"/"x" don't fight over the same string.
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

type Props = {
  platform?: PlatformSlug;
  /** Extra text used to detect the platform when `platform` is omitted. */
  detectFrom?: string | null;
  size?: number;
  className?: string;
  /** Renders the tile without the rounded-square background (for inline rows). */
  bare?: boolean;
};

export function PlatformBadge({ platform, detectFrom, size = 32, className, bare }: Props) {
  const slug = platform ?? platformFor(detectFrom);
  const label = LABELS[slug];
  const radius = Math.round(size * 0.3);

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        flex: "0 0 auto",
        borderRadius: bare ? 0 : radius,
        background: bare ? "transparent" : TILE[slug],
        boxShadow: bare ? "none" : "inset 0 0 0 1px rgba(15,23,42,0.06)",
        overflow: "hidden",
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width={Math.round(size * 0.72)}
        height={Math.round(size * 0.72)}
        aria-hidden="true"
        focusable="false"
      >
        <Mark slug={slug} />
      </svg>
    </span>
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
