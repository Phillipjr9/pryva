/**
 * The gift-card rules that both the checkout and the marketing page quote.
 *
 * Kept in one dependency-free module so the explainer cannot drift from the
 * enforcement. `src/lib/gift-cards.ts` validates against these values and adds
 * the database work; the page renders them. A test compares the two.
 */

export const GIFT_CARD_MIN_AMOUNT = 1000;
export const GIFT_CARD_MAX_AMOUNT = 500000;
/** One year, expressed in months so the boundary is not a leap-year argument. */
export const GIFT_CARD_VALIDITY_MONTHS = 12;
