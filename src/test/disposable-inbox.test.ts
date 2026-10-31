import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFreeInbox,
  dailyKeyFor,
  discardInbox,
  InboxError,
  listInboxes,
  mayHaveSpentMoney,
  messageFingerprint,
  pollInbox,
} from "@/lib/disposable-inbox";
import { FleexaError } from "@/lib/fleexa";

/**
 * The free inbox spends real money every time one is created, so the tests that
 * matter here are not the happy path — they are the ones about what happens when
 * a limit says no after the supplier has already sold us an inbox, and about
 * whose mailbox a request can read.
 */

const mocks = vi.hoisted(() => ({
  buy: vi.fn(),
  products: vi.fn(),
  check: vi.fn(),
  cancel: vi.fn(),
  configured: vi.fn(),
  state: {
    calls: [] as string[],
    selectRows: [] as Record<string, unknown>[],
    messageRows: [] as Record<string, unknown>[],
    insertError: null as Error | null,
    updateResult: [] as Record<string, unknown>[],
    insertedMessages: [] as Record<string, unknown>[],
  },
}));

vi.mock("@/lib/fleexa", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fleexa")>();
  return {
    ...actual,
    buyFleexaEmail: mocks.buy,
    checkFleexaEmail: mocks.check,
    cancelFleexaEmail: mocks.cancel,
    isFleexaConfigured: mocks.configured,
    listFleexaEmailProducts: mocks.products,
  };
});
// Every level the real logger exposes: a partial mock turns a call to a missing
// method into a TypeError that reads as a broken module rather than a broken test.
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/db", async () => {
  const schema = await import("@/db/schema");
  // A drizzle builder is thenable, and some queries are awaited directly while
  // others chain .limit() — so each stage has to support both.
  const nameOf = (table: unknown) =>
    table === schema.inboxMessages ? "inbox_messages" : table === schema.disposableInboxes ? "disposable_inboxes" : "unknown";

  const thenable = (rows: () => Record<string, unknown>[]) => ({
    then: (resolve: (value: Record<string, unknown>[]) => unknown) => Promise.resolve(rows()).then(resolve),
    limit: async (n: number) => rows().slice(0, n),
    orderBy: () => thenable(rows),
  });

  const db = {
    insert: (table: unknown) => ({
      values: (value: unknown) => ({
        returning: async () => {
          mocks.state.calls.push(`insert:${nameOf(table)}`);
          if (mocks.state.insertError) throw mocks.state.insertError;
          const row = {
            id: "inbox-1",
            ...(value as Record<string, unknown>),
            domain: null,
            createdAt: new Date("2026-10-30T12:00:00Z"),
            discardedAt: null,
          };
          mocks.state.selectRows = [row];
          return [row];
        },
        onConflictDoNothing: async () => {
          mocks.state.calls.push(`insert:${nameOf(table)}:on-conflict`);
          // A bulk insert passes an array of rows; record the rows themselves so
          // the assertions below read as "which messages were written".
          const rows = Array.isArray(value) ? value : [value];
          mocks.state.insertedMessages.push(...(rows as Record<string, unknown>[]));
          return [];
        },
      }),
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: () =>
          thenable(() => (table === schema.inboxMessages ? mocks.state.messageRows : mocks.state.selectRows)),
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            mocks.state.calls.push(`update:${nameOf(table)}`);
            return mocks.state.updateResult.map((row) => ({ ...row, ...values }));
          },
        }),
      }),
    }),
  };
  return { db };
});

const USER = "user-1";
const ACTIVE_ROW = {
  id: "inbox-1",
  address: "someone@inbox.test",
  tier: "free",
  status: "active",
  expiresAt: null,
  createdAt: new Date("2026-10-30T12:00:00Z"),
  discardedAt: null,
  providerInboxId: "prov-1",
};

/** What a real unique-violation error looks like, index name included. */
function uniqueViolation(index: string) {
  return new Error(`duplicate key value violates unique constraint "${index}"`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.state.calls = [];
  mocks.state.selectRows = [];
  mocks.state.messageRows = [];
  mocks.state.insertError = null;
  mocks.state.updateResult = [];
  mocks.state.insertedMessages = [];
  mocks.configured.mockReturnValue(true);
  mocks.buy.mockResolvedValue({
    emailId: "prov-1",
    address: "someone@inbox.test",
    expiresAt: null,
    raw: {},
  });
  mocks.cancel.mockImplementation(async () => {
    mocks.state.calls.push("cancel");
  });
  mocks.check.mockResolvedValue({ messages: [], code: null, raw: {} });
  // Default: one product, so the purchase names it. Tests that care override.
  mocks.products.mockResolvedValue([
    { id: "p-expensive", name: "30-day inbox", domain: null, priceNgn: 900, stock: 5 },
    { id: "p-cheap", name: "10-minute inbox", domain: null, priceNgn: 100, stock: 5 },
  ]);
});

afterEach(() => vi.resetAllMocks());

describe("the daily key", () => {
  it("is scoped to a UTC day, so two servers cannot disagree about it", () => {
    // 23:30 in Lagos is still the same UTC day; 00:30 the next morning is not.
    expect(dailyKeyFor("u1", new Date("2026-10-30T23:30:00Z"))).toBe("u1:2026-10-30");
    expect(dailyKeyFor("u1", new Date("2026-10-31T00:30:00Z"))).toBe("u1:2026-10-31");
  });

  it("separates one account from another on the same day", () => {
    const now = new Date("2026-10-30T12:00:00Z");
    expect(dailyKeyFor("u1", now)).not.toBe(dailyKeyFor("u2", now));
  });
});

describe("the message fingerprint", () => {
  const message = { subject: "Your code", from: "no-reply@x.test", body: "123456", code: "123456", receivedAt: "2026-10-30T12:00:00Z" };

  it("is stable, so a repeated poll inserts nothing new", () => {
    expect(messageFingerprint(message)).toBe(messageFingerprint({ ...message }));
  });

  it("distinguishes two messages that differ only in body", () => {
    expect(messageFingerprint(message)).not.toBe(messageFingerprint({ ...message, body: "654321" }));
  });

  it("survives a mailbox whose fields are all missing", () => {
    expect(messageFingerprint({ subject: null, from: null, body: null, code: null, receivedAt: null })).toHaveLength(64);
  });
});

describe("choosing what to buy", () => {
  it("names the cheapest product with stock, because a free inbox is free to the customer", async () => {
    await createFreeInbox(USER);
    expect(mocks.buy).toHaveBeenCalledWith({ product: "p-cheap" });
  });

  it("skips a product the feed says has none left", async () => {
    mocks.products.mockResolvedValue([
      { id: "p-empty", name: "Sold out", domain: null, priceNgn: 50, stock: 0 },
      { id: "p-stocked", name: "In stock", domain: null, priceNgn: 300, stock: 2 },
    ]);
    await createFreeInbox(USER);
    expect(mocks.buy).toHaveBeenCalledWith({ product: "p-stocked" });
  });

  it("still buys when the product list cannot be read, rather than failing early", async () => {
    mocks.products.mockRejectedValue(new FleexaError("Provider request failed", 502, "UPSTREAM_ERROR"));
    await createFreeInbox(USER);
    // The purchase falls back to the call it always made: some feeds need no product.
    expect(mocks.buy).toHaveBeenCalledWith({});
  });

  it("does not invent a product when the feed lists none", async () => {
    mocks.products.mockResolvedValue([]);
    await createFreeInbox(USER);
    expect(mocks.buy).toHaveBeenCalledWith({});
  });
});

describe("deciding whether a failure may have cost money", () => {
  it("treats a refusal as free, so the customer keeps their attempt", () => {
    expect(mayHaveSpentMoney(new FleexaError("refused", 502, "UPSTREAM_ERROR"))).toBe(false);
    expect(mayHaveSpentMoney(new FleexaError("slow down", 429, "RATE_LIMITED"))).toBe(false);
    expect(mayHaveSpentMoney(new InboxError("DAILY_LIMIT", 429, "used today"))).toBe(false);
    expect(mayHaveSpentMoney(new InboxError("NOT_CONFIGURED", 503, "off"))).toBe(false);
  });

  it("treats an ambiguous outcome as spent, so retries are not free", () => {
    expect(mayHaveSpentMoney(new FleexaError("no answer", 502, "UPSTREAM_UNREACHABLE"))).toBe(true);
    expect(mayHaveSpentMoney(new FleexaError("incomplete", 502, "INCOMPLETE_RECEIPT"))).toBe(true);
    expect(mayHaveSpentMoney(new InboxError("RECONCILE_FAILED", 502, "checking"))).toBe(true);
    expect(mayHaveSpentMoney(new Error("something else"))).toBe(true);
  });
});

describe("creating a free inbox", () => {
  it("refuses without spending anything when the source is not configured", async () => {
    mocks.configured.mockReturnValue(false);

    await expect(createFreeInbox(USER)).rejects.toMatchObject({ code: "NOT_CONFIGURED", status: 503 });
    // The important half: no purchase was attempted.
    expect(mocks.buy).not.toHaveBeenCalled();
  });

  it("returns the inbox the supplier sold us", async () => {
    const created = await createFreeInbox(USER);

    expect(created).toMatchObject({ address: "someone@inbox.test", tier: "free", status: "active" });
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  /**
   * The money-critical case. The supplier is called before the row is written,
   * because the address only exists once it has accepted the purchase — so a
   * refusal from our own unique index leaves us holding an inbox we paid for and
   * cannot record. Cancelling it is what stops the daily limit from becoming a
   * way to spend money on nothing.
   */
  it("gives the purchased inbox back when the daily limit refuses the row", async () => {
    mocks.state.insertError = uniqueViolation("disposable_inboxes_free_daily_key");

    await expect(createFreeInbox(USER)).rejects.toMatchObject({ code: "DAILY_LIMIT", status: 429 });
    expect(mocks.buy).toHaveBeenCalledTimes(1);
    expect(mocks.cancel).toHaveBeenCalledWith("prov-1");
  });

  it("gives the purchased inbox back when an active inbox already exists", async () => {
    mocks.state.insertError = uniqueViolation("disposable_inboxes_one_active_free_per_user");

    await expect(createFreeInbox(USER)).rejects.toMatchObject({ code: "ALREADY_ACTIVE", status: 429 });
    expect(mocks.cancel).toHaveBeenCalledWith("prov-1");
  });

  it("does not swallow a failure that is not a limit", async () => {
    mocks.state.insertError = new Error("connection terminated");

    // Re-thrown rather than reported as a limit, so a database outage is not
    // misexplained to the customer as "you already used today's inbox".
    await expect(createFreeInbox(USER)).rejects.toThrow("connection terminated");
    expect(mocks.cancel).not.toHaveBeenCalled();
  });

  it("still refuses the request when giving the inbox back fails", async () => {
    mocks.state.insertError = uniqueViolation("disposable_inboxes_free_daily_key");
    mocks.cancel.mockRejectedValue(new Error("cancel unavailable"));

    // The limit stands either way; a failed compensation is logged, not turned
    // into a granted inbox.
    await expect(createFreeInbox(USER)).rejects.toBeInstanceOf(InboxError);
  });
});

describe("reading an inbox", () => {
  it("refuses to read an inbox that belongs to somebody else", async () => {
    mocks.state.selectRows = []; // the ownership lookup is part of the query

    await expect(pollInbox(USER, "someone-elses-inbox")).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    // And it never reached the supplier with another customer's inbox id.
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it("stores nothing for a free inbox, because keeping nothing is the free tier", async () => {
    mocks.state.selectRows = [ACTIVE_ROW];
    mocks.check.mockResolvedValue({
      messages: [{ subject: "Your code", from: "no-reply@x.test", body: "123456", code: "123456", receivedAt: null }],
      code: "123456",
      raw: {},
    });

    const result = await pollInbox(USER, "inbox-1");

    expect(result.code).toBe("123456");
    expect(result.stored).toBe(false);
    expect(mocks.state.insertedMessages).toEqual([]);
  });

  it("retains messages for a paid inbox, idempotently", async () => {
    mocks.state.selectRows = [{ ...ACTIVE_ROW, tier: "paid" }];
    mocks.check.mockResolvedValue({
      messages: [{ subject: "Your code", from: "no-reply@x.test", body: "123456", code: "123456", receivedAt: null }],
      code: "123456",
      raw: {},
    });

    await pollInbox(USER, "inbox-1");
    await pollInbox(USER, "inbox-1");

    // Both polls wrote through onConflictDoNothing, so the unique index — not
    // application logic — is what stops the mailbox being duplicated.
    expect(mocks.state.calls.filter((c) => c === "insert:inbox_messages:on-conflict")).toHaveLength(2);
    expect(mocks.state.insertedMessages[0]).toMatchObject({ inboxId: "inbox-1", userId: USER });
  });

  it("does not call the supplier again for an inbox that has already ended", async () => {
    mocks.state.selectRows = [{ ...ACTIVE_ROW, status: "discarded" }];
    mocks.state.messageRows = [];

    const result = await pollInbox(USER, "inbox-1");

    expect(result.stored).toBe(true);
    expect(mocks.check).not.toHaveBeenCalled();
  });
});

describe("discarding an inbox", () => {
  beforeEach(() => {
    mocks.state.selectRows = [ACTIVE_ROW];
    mocks.state.updateResult = [ACTIVE_ROW];
  });

  it("cancels at the supplier before marking the row discarded", async () => {
    await discardInbox(USER, "inbox-1");

    // The order is the point: marking first would let a failed cancellation leave
    // the customer looking at a closed inbox that is still receiving mail
    // somewhere they can no longer read. Both are recorded in one log so this is
    // a single comparison rather than two counters that cannot be related.
    expect(mocks.state.calls).toEqual(["cancel", "update:disposable_inboxes"]);
    expect(mocks.cancel).toHaveBeenCalledWith("prov-1");
  });

  it("reports a conflict rather than claiming success when the row moved", async () => {
    mocks.state.updateResult = []; // the guarded update matched nothing

    await expect(discardInbox(USER, "inbox-1")).rejects.toMatchObject({
      code: "RECONCILE_FAILED",
      status: 409,
    });
  });

  it("is idempotent for an inbox that is already gone", async () => {
    mocks.state.selectRows = [{ ...ACTIVE_ROW, status: "discarded" }];

    const view = await discardInbox(USER, "inbox-1");

    expect(view.status).toBe("discarded");
    expect(mocks.cancel).not.toHaveBeenCalled();
  });
});

describe("listing inboxes", () => {
  it("returns only what the query was scoped to, newest first", async () => {
    mocks.state.selectRows = [ACTIVE_ROW];

    const inboxes = await listInboxes(USER);

    expect(inboxes).toHaveLength(1);
    expect(inboxes[0]).toMatchObject({ id: "inbox-1", address: "someone@inbox.test" });
  });
});
