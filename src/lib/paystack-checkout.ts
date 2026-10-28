/** Accept only Paystack's documented hosted checkout origin. */
export function isSafePaystackCheckoutUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "checkout.paystack.com" && !url.port && !url.username && !url.password;
  } catch {
    return false;
  }
}
