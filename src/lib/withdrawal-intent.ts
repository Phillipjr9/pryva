import { MAX_WITHDRAWAL, MIN_WITHDRAWAL } from "./withdrawal";

export interface WithdrawalIntent {
  requestId: string;
  amount: number;
  bankAccountId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Only non-secret request identifiers are stored; bank details stay on the server. */
export function readWithdrawalIntent(storage: Storage, key: string): WithdrawalIntent | null {
  const raw = storage.getItem(key);
  if (raw === null) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error("Unreadable withdrawal recovery state"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid withdrawal recovery state");
  const { requestId, amount, bankAccountId } = value as Record<string, unknown>;
  if (typeof requestId !== "string" || !UUID.test(requestId) ||
      typeof bankAccountId !== "string" || !UUID.test(bankAccountId) ||
      typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < MIN_WITHDRAWAL || amount > MAX_WITHDRAWAL) {
    throw new Error("Invalid withdrawal recovery state");
  }
  return { requestId: requestId.toLowerCase(), amount, bankAccountId: bankAccountId.toLowerCase() };
}

export function saveWithdrawalIntent(storage: Storage, key: string, intent: WithdrawalIntent): void {
  storage.setItem(key, JSON.stringify(intent));
}

/** Never erase a different request saved by another tab. */
export function clearWithdrawalIntent(storage: Storage, key: string, requestId: string): boolean {
  const current = readWithdrawalIntent(storage, key);
  if (current?.requestId !== requestId.toLowerCase()) return false;
  storage.removeItem(key);
  return true;
}

/**
 * New requests use separate keys so simultaneous tabs cannot overwrite each
 * other's recovery IDs. The old single-key record is still read and retried.
 */
export function readWithdrawalIntents(storage: Storage, key: string): WithdrawalIntent[] {
  const intents = new Map<string, WithdrawalIntent>();
  const add = (intent: WithdrawalIntent) => {
    const existing = intents.get(intent.requestId);
    if (existing && (existing.amount !== intent.amount || existing.bankAccountId !== intent.bankAccountId)) throw new Error("Conflicting withdrawal recovery state");
    intents.set(intent.requestId, intent);
    if (intents.size > 50) throw new Error("Too many withdrawal recovery records");
  };
  const legacy = readWithdrawalIntent(storage, key);
  if (legacy) add(legacy);
  for (let i = 0; i < storage.length; i++) {
    const savedKey = storage.key(i);
    if (!savedKey?.startsWith(`${key}.`)) continue;
    const intent = readWithdrawalIntent(storage, savedKey);
    if (!intent || savedKey !== `${key}.${intent.requestId}`) throw new Error("Invalid withdrawal recovery key");
    add(intent);
  }
  return [...intents.values()];
}

export function saveTrackedWithdrawalIntent(storage: Storage, key: string, intent: WithdrawalIntent): void {
  if (!UUID.test(intent.requestId) || !UUID.test(intent.bankAccountId) || !Number.isSafeInteger(intent.amount) || intent.amount < MIN_WITHDRAWAL || intent.amount > MAX_WITHDRAWAL) throw new Error("Invalid withdrawal recovery state");
  saveWithdrawalIntent(storage, `${key}.${intent.requestId.toLowerCase()}`, { ...intent, requestId: intent.requestId.toLowerCase(), bankAccountId: intent.bankAccountId.toLowerCase() });
}

export function clearTrackedWithdrawalIntent(storage: Storage, key: string, requestId: string): void {
  if (!UUID.test(requestId)) throw new Error("Invalid withdrawal request ID");
  // Validate the complete set before deleting anything; never erase another ID.
  readWithdrawalIntents(storage, key);
  clearWithdrawalIntent(storage, key, requestId);
  clearWithdrawalIntent(storage, `${key}.${requestId.toLowerCase()}`, requestId);
}
