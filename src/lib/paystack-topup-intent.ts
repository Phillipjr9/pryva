/** Only the reference and amount are kept for recovery; never the checkout URL or payment details. */
export type PendingPaystackTopUp = { reference: string; amount: number };
export const PAYSTACK_TOPUP_UPDATED = "pryva:paystack-topups-updated";
const REFERENCE = /^TOP-[a-f0-9]{24}$/i;

function prefix(userId: string) { return `pryva.topup.pending.v1.${userId}.`; }
function valid(value: unknown): value is PendingPaystackTopUp {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const { reference, amount } = value as Record<string, unknown>;
  return typeof reference === "string" && REFERENCE.test(reference) && typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 1_000 && amount <= 500_000;
}

/** Each reference has its own key so another tab cannot overwrite it. */
export function readPendingPaystackTopUps(storage: Storage, userId: string): PendingPaystackTopUp[] {
  const entries: PendingPaystackTopUp[] = [];
  const keyPrefix = prefix(userId);
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(keyPrefix)) continue;
    if (entries.length >= 50) throw new Error("Too many saved payment references");
    const raw = storage.getItem(key);
    if (raw === null || raw.length > 512) throw new Error("Unreadable payment reference");
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error("Unreadable payment reference"); }
    if (!valid(value) || key !== keyPrefix + value.reference) throw new Error("Invalid payment reference");
    entries.push({ reference: value.reference, amount: value.amount });
  }
  return entries;
}

export function rememberPaystackTopUp(storage: Storage, userId: string, intent: PendingPaystackTopUp): void {
  if (!valid(intent)) throw new Error("Invalid payment reference");
  storage.setItem(prefix(userId) + intent.reference, JSON.stringify(intent));
}

export function forgetPaystackTopUp(storage: Storage, userId: string, reference: string): void {
  if (!REFERENCE.test(reference)) throw new Error("Invalid payment reference");
  storage.removeItem(prefix(userId) + reference);
}

export function notifyPaystackTopUpsChanged() {
  window.dispatchEvent(new Event(PAYSTACK_TOPUP_UPDATED));
}
