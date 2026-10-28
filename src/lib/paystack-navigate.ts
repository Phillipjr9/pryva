import { isSafePaystackCheckoutUrl } from "./paystack-checkout";

/** Only a validated Paystack checkout may become a browser navigation. */
export function navigateToPaystack(url: string) {
  if (!isSafePaystackCheckoutUrl(url)) throw new Error("Invalid Paystack checkout URL");
  window.location.assign(url);
}
