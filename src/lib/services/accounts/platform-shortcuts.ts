type AccountText = { title: string; category: string | null; subcategory: string | null };
export type AccountShortcut = { key: string; label: string; query: string };

// A single X must be a platform name, not a letter in Xbox or Netflix. Keep
// this matcher shared with the marketplace search used by the X shortcut.
const TWITTER = /\btwitter\b|\bx\.com\b|(?:^|[\s(])x(?=\s+(?:accounts?|profiles?|aged|verified|premium)\b|[)\]:/]|\s*$)/i;
export function mentionsTwitterAccount(text: string): boolean { return TWITTER.test(text); }

const PLATFORMS: ReadonlyArray<{ key: string; label: string; match: RegExp }> = [
  { key: "facebook", label: "Facebook", match: /\bfacebook\b/i },
  { key: "instagram", label: "Instagram", match: /\binstagram\b/i },
  { key: "tiktok", label: "TikTok", match: /\btik\s?tok\b/i },
  { key: "x", label: "X / Twitter", match: TWITTER },
  { key: "snapchat", label: "Snapchat", match: /\bsnapchat\b/i },
  { key: "reddit", label: "Reddit", match: /\breddit\b/i },
  { key: "discord", label: "Discord", match: /\bdiscord\b/i },
  { key: "youtube", label: "YouTube", match: /\byou\s?tube\b/i },
  { key: "telegram", label: "Telegram", match: /\btelegram\b/i },
  { key: "whatsapp", label: "WhatsApp", match: /\bwhats\s?app\b/i },
  { key: "gmail", label: "Gmail", match: /\bgmail\b/i },
  { key: "outlook", label: "Outlook", match: /\boutlook\b/i },
  { key: "hotmail", label: "Hotmail", match: /\bhotmail\b/i },
  { key: "google", label: "Google", match: /\bgoogle\b/i },
  { key: "apple", label: "Apple", match: /\bapple\b/i },
  { key: "linkedin", label: "LinkedIn", match: /\blinkedin\b/i },
  { key: "pinterest", label: "Pinterest", match: /\bpinterest\b/i },
  { key: "netflix", label: "Netflix", match: /\bnetflix\b/i },
  { key: "spotify", label: "Spotify", match: /\bspotify\b/i },
  { key: "steam", label: "Steam", match: /\bsteam\b/i },
  { key: "twitch", label: "Twitch", match: /\btwitch\b/i },
  { key: "chatgpt", label: "ChatGPT", match: /\bchatgpt\b/i },
  { key: "canva", label: "Canva", match: /\bcanva\b/i },
];

/** Choices are drawn from the loaded page, not a list of presumed inventory. */
export function accountPlatformShortcuts(listings: readonly AccountText[]): AccountShortcut[] {
  return PLATFORMS.flatMap(({ key, label, match }) => {
    for (const listing of listings) {
      const text = [listing.title, listing.category, listing.subcategory].filter(Boolean).join(" ");
      const found = match.exec(text);
      if (found) return [{ key, label, query: key === "x" ? "Twitter" : found[0].trim() }];
    }
    return [];
  });
}
