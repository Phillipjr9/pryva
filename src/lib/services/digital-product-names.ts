/** Explicit product names at the start of a title, not a list of available stock. */
const NAMED_PRODUCTS: ReadonlyArray<[RegExp, string]> = [
  [/^call[ -]of[ -]duty[ :\-]*mobile\b/i, "Call of Duty Mobile"],
  [/^mobile[ -]legends\b/i, "Mobile Legends"], [/^free[ -]fire\b/i, "Free Fire"],
  [/^8[ -]ball[ -]pool\b/i, "8 Ball Pool"], [/^clash[ -]of[ -]clans\b/i, "Clash of Clans"],
  [/^clash[ -]royale\b/i, "Clash Royale"], [/^brawl[ -]stars\b/i, "Brawl Stars"],
  [/^youtube[ -]music\b/i, "YouTube Music"], [/^youtube[ -]tv\b/i, "YouTube TV"],
  [/^apple[ -]music\b/i, "Apple Music"], [/^apple[ -]tv\b/i, "Apple TV"],
  [/^google[ -]play\b/i, "Google Play"], [/^google[ -]one\b/i, "Google One"],
  [/^amazon[ -]prime\b/i, "Amazon Prime"], [/^microsoft[ -]365\b/i, "Microsoft 365"],
  [/^nintendo[ -]switch[ -]online\b/i, "Nintendo Switch Online"], [/^nintendo[ -]eshop\b/i, "Nintendo eShop"],
  [/^disney\s*(?:\+|plus)(?=\s|$)/i, "Disney+"], [/^hbo[ -]max\b/i, "HBO Max"],
  [/^netflix\b/i, "Netflix"], [/^spotify\b/i, "Spotify"], [/^youtube\b/i, "YouTube"],
  [/^crunchyroll\b/i, "Crunchyroll"], [/^showmax\b/i, "Showmax"], [/^hulu\b/i, "Hulu"], [/^deezer\b/i, "Deezer"],
  [/^telegram\b/i, "Telegram"], [/^discord\b/i, "Discord"], [/^playstation\b/i, "PlayStation"],
  [/^xbox\b/i, "Xbox"], [/^steam\b/i, "Steam"], [/^roblox\b/i, "Roblox"],
  [/^pubg\b/i, "PUBG"], [/^fortnite\b/i, "Fortnite"], [/^valorant\b/i, "Valorant"],
  [/^minecraft\b/i, "Minecraft"], [/^genshin[ -]impact\b/i, "Genshin Impact"],
  [/^chatgpt\b/i, "ChatGPT"], [/^claude\b/i, "Claude"], [/^canva\b/i, "Canva"], [/^amazon\b/i, "Amazon"],
];

/** A recognized prefix only; unknown titles must remain unclassified. */
export function namedDigitalProduct(name: string): string | null {
  return NAMED_PRODUCTS.find(([pattern]) => pattern.test(name.trim()))?.[1] ?? null;
}
