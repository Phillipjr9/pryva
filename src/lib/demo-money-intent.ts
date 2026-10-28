import { MAX_WITHDRAWAL, MIN_WITHDRAWAL } from "@/lib/withdrawal";

/** Only non-sensitive retry data is kept in this tab for an uncertain demo request. */
export type DemoMoneyKind = "add" | "send";
export type DemoMoneyMethod = "bank-transfer" | "card" | "demo-transfer";
export type DemoMoneyIntent = { kind: DemoMoneyKind; amount: number; method: DemoMoneyMethod; requestId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function demoMoneyStorageKey(userId: string, kind: DemoMoneyKind) {
  return `pryva:demo-money:${userId}:${kind}`;
}

/** Browser storage is untrusted; an invalid saved intent is never submitted. */
export function parseDemoMoneyIntent(raw: string | null, kind: DemoMoneyKind): DemoMoneyIntent | null {
  if (!raw || raw.length > 1024) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const intent = value as Partial<DemoMoneyIntent>;
    const max = kind === "add" ? 500_000 : MAX_WITHDRAWAL;
    const methodValid = kind === "add" ? intent.method === "card" || intent.method === "bank-transfer" : intent.method === "demo-transfer";
    if (intent.kind !== kind || typeof intent.amount !== "number" || !Number.isSafeInteger(intent.amount) || intent.amount < MIN_WITHDRAWAL || intent.amount > max || !methodValid || typeof intent.requestId !== "string" || !UUID.test(intent.requestId)) return null;
    return { kind, amount: intent.amount, method: intent.method as DemoMoneyMethod, requestId: intent.requestId };
  } catch {
    return null;
  }
}
