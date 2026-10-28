import { describe, expect, it } from "vitest";
import { clearWithdrawalIntent, clearTrackedWithdrawalIntent, readWithdrawalIntent, readWithdrawalIntents, saveWithdrawalIntent, saveTrackedWithdrawalIntent } from "@/lib/withdrawal-intent";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

const intent = { requestId: "da16d859-1301-4851-a124-b9dddf107333", amount: 6000, bankAccountId: "6db3231e-312b-4f81-82a2-2d078e784b6f" };

describe("withdrawal recovery state", () => {
  it("persists only the retry key and parameters and restores them on reload", () => {
    const storage = memoryStorage();
    saveWithdrawalIntent(storage, "user-one", intent);
    expect(readWithdrawalIntent(storage, "user-one")).toEqual(intent);
    expect(readWithdrawalIntent(storage, "user-two")).toBeNull();
    expect(storage.getItem("user-one")).not.toContain("accountNumber");
  });

  it("refuses corrupt recovery state rather than forgetting an uncertain request", () => {
    const storage = memoryStorage();
    storage.setItem("key", "not json");
    expect(() => readWithdrawalIntent(storage, "key")).toThrow();
    storage.setItem("key", JSON.stringify({ ...intent, amount: -1 }));
    expect(() => readWithdrawalIntent(storage, "key")).toThrow();
  });

  it("retains independent cross-tab keys and an older single-key record", () => {
    const storage = memoryStorage();
    const other = { ...intent, requestId: "47a7c568-8781-416b-8393-57ed13b89d42", amount: 7000 };
    saveWithdrawalIntent(storage, "key", intent); // A record created by the previous UI.
    saveTrackedWithdrawalIntent(storage, "key", other);
    saveTrackedWithdrawalIntent(storage, "different-user", intent);
    expect(readWithdrawalIntents(storage, "key")).toEqual([intent, other]);
    clearTrackedWithdrawalIntent(storage, "key", other.requestId);
    expect(readWithdrawalIntents(storage, "key")).toEqual([intent]);
    expect(readWithdrawalIntents(storage, "different-user")).toEqual([intent]);
    clearTrackedWithdrawalIntent(storage, "key", intent.requestId);
    expect(readWithdrawalIntents(storage, "key")).toEqual([]);
  });

  it("fails closed on corrupt or conflicting per-request recovery records", () => {
    const storage = memoryStorage();
    saveWithdrawalIntent(storage, "key", intent);
    storage.setItem(`key.${intent.requestId}`, JSON.stringify({ ...intent, amount: 8000 }));
    expect(() => readWithdrawalIntents(storage, "key")).toThrow();
    expect(() => clearTrackedWithdrawalIntent(storage, "key", intent.requestId)).toThrow();
    expect(storage.getItem("key")).not.toBeNull();
    storage.removeItem(`key.${intent.requestId}`);
    storage.setItem("key.not-an-id", JSON.stringify(intent));
    expect(() => readWithdrawalIntents(storage, "key")).toThrow();
  });

  it("does not erase a different tab's newer intent", () => {
    const storage = memoryStorage();
    saveWithdrawalIntent(storage, "key", intent);
    expect(clearWithdrawalIntent(storage, "key", "47a7c568-8781-416b-8393-57ed13b89d42")).toBe(false);
    expect(readWithdrawalIntent(storage, "key")).toEqual(intent);
    expect(clearWithdrawalIntent(storage, "key", intent.requestId)).toBe(true);
    expect(readWithdrawalIntent(storage, "key")).toBeNull();
  });
});
