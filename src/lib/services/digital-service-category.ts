/** Explicit names only: a game top-up or store balance is not automatically a gift card. */
export function isNamedGiftCard(name: string): boolean {
  return /\b(?:gift\s*cards?|gift\s*vouchers?|gift\s*codes?)\b/i.test(name);
}
