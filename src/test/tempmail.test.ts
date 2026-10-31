import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelTempMail,
  checkTempMail,
  createTempMailInbox,
  extractVerificationCode,
  isTempMailConfigured,
} from "@/lib/tempmail";
import {
  activateInbox,
  createFreeInbox,
  discardInbox,
  getInboxProvider,
  isInboxConfigured,
  pollInbox,
} from "@/lib/disposable-inbox";

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const dbState = vi.hoisted(() => ({
  calls: [] as string[],
  rows: [] as Record<string, unknown>[],
  updateResult: [] as Record<string, unknown>[],
  insertedMessages: [] as Record<string, unknown>[],
}));

vi.mock("@/db", async () => {
  const schema = await import("@/db/schema");
  const thenable = (rows: () => Record<string, unknown>[]) => ({
    then: (resolve: (value: Record<string, unknown>[]) => unknown) => Promise.resolve(rows()).then(resolve),
    limit: async (n: number) => rows().slice(0, n),
    orderBy: () => thenable(rows),
  });

  const db = {
    insert: (table: unknown) => ({
      values: (val: unknown) => ({
        returning: async () => {
          const row = {
            id: "inbox-temp-1",
            ...(val as Record<string, unknown>),
            createdAt: new Date("2026-10-31T12:00:00Z"),
            discardedAt: null,
          };
          dbState.rows.push(row);
          return [row];
        },
        onConflictDoNothing: async () => {
          const items = Array.isArray(val) ? val : [val];
          dbState.insertedMessages.push(...items);
          return [];
        },
      }),
    }),
    select: () => ({
      from: (table: unknown) => ({
        where: () => thenable(() => (table === schema.inboxMessages ? dbState.insertedMessages : dbState.rows)),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => dbState.updateResult.map((row) => ({ ...row, ...values })),
        }),
      }),
    }),
  };
  return { db };
});

describe("extractVerificationCode", () => {
  it("extracts 6-digit codes with explicit keywords", () => {
    expect(extractVerificationCode("Your verification code", "Your verification code is 849201")).toBe("849201");
    expect(extractVerificationCode(null, "Use OTP code 482910 to login.")).toBe("482910");
    expect(extractVerificationCode("Your code is 123456", "Click here to confirm.")).toBe("123456");
  });

  it("extracts 4-digit pins and codes", () => {
    expect(extractVerificationCode("Confirm email", "Your security pin: 4920.")).toBe("4920");
    expect(extractVerificationCode("Login OTP: 8192", "")).toBe("8192");
  });

  it("extracts alphanumeric verification tokens", () => {
    expect(extractVerificationCode("Login", "Your confirmation code: AB49Z")).toBe("AB49Z");
  });

  it("extracts standalone numbers from subject when no keyword is in text", () => {
    expect(extractVerificationCode("849201 is your sign-in code", "Hello user")).toBe("849201");
  });

  it("returns null for empty or non-code messages", () => {
    expect(extractVerificationCode(null, null)).toBeNull();
    expect(extractVerificationCode("Newsletter", "Check out our weekly articles and updates!")).toBeNull();
  });
});

describe("createTempMailInbox", () => {
  it("generates a valid address on a public domain", async () => {
    const inbox = await createTempMailInbox();
    expect(inbox.address).toContain("@");
    expect(inbox.domain).toBeTruthy();
    expect(inbox.id).toContain(":");
  });

  it("is configured by default without credentials", () => {
    expect(isTempMailConfigured()).toBe(true);
  });
});

describe("checkTempMail and cancelTempMail", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    dbState.calls = [];
    dbState.rows = [];
    dbState.updateResult = [];
    dbState.insertedMessages = [];
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("polls and formats incoming Mail.tm messages with extracted codes", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/token")) {
        return Promise.resolve({ ok: true, json: async () => ({ token: "jwt-test-token" }) });
      }
      if (url.includes("/messages") && !url.includes("/messages/")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            "hydra:member": [
              { id: "msg-1", subject: "Your code is 591024", from: { address: "auth@service.com" }, createdAt: "2026-10-31" },
            ],
          }),
        });
      }
      if (url.includes("/messages/msg-1")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            subject: "Your code is 591024",
            from: { address: "auth@service.com" },
            text: "Your verification code is 591024",
            createdAt: "2026-10-31",
          }),
        });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });

    const result = await checkTempMail("mailtm:acc-123:mypassword", "test@domain.com");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      from: "auth@service.com",
      subject: "Your code is 591024",
      body: "Your verification code is 591024",
      code: "591024",
    });
    expect(result.code).toBe("591024");
  });

  it("polls and formats incoming Guerrilla Mail messages", async () => {
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("check_email")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            list: [
              { mail_id: "gm-42", mail_from: "verify@app.test", mail_subject: "OTP: 884422", mail_date: "2026-10-31" },
            ],
          }),
        });
      }
      if (url.includes("fetch_email")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            mail_subject: "OTP: 884422",
            mail_from: "verify@app.test",
            mail_body: "Use 884422 to confirm your account",
            mail_date: "2026-10-31",
          }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    const result = await checkTempMail("guerrilla:sid-token-xyz:test@sharklasers.com");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]?.code).toBe("884422");
    expect(result.code).toBe("884422");
  });

  it("handles empty inboxes gracefully", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    const result = await checkTempMail("emptyuser:1secmail.com");
    expect(result.messages).toEqual([]);
    expect(result.code).toBeNull();
  });

  it("cancels cleanly as a no-op", async () => {
    await expect(cancelTempMail("myid:1secmail.com")).resolves.toBeUndefined();
  });
});

describe("integration with disposable-inbox lifecycle", () => {
  const originalEnv = process.env.INBOX_PROVIDER;

  beforeEach(() => {
    process.env.INBOX_PROVIDER = "tempmail";
    dbState.rows = [];
    dbState.updateResult = [];
    dbState.insertedMessages = [];
  });

  afterEach(() => {
    process.env.INBOX_PROVIDER = originalEnv;
  });

  it("selects tempmail when configured or when fleexa is not set", () => {
    expect(getInboxProvider()).toBe("tempmail");
    expect(isInboxConfigured()).toBe(true);
  });

  it("creates a free inbox via tempmail and saves to db", async () => {
    const created = await createFreeInbox("user-1");
    expect(created.address).toContain("@");
    expect(created.tier).toBe("free");
    expect(created.status).toBe("active");
  });

  it("polls and stores live messages in the database", async () => {
    const activeRow = {
      id: "inbox-temp-1",
      userId: "user-1",
      provider: "tempmail",
      providerInboxId: "guerrilla:sid-token:test@sharklasers.com",
      address: "test@sharklasers.com",
      tier: "free",
      status: "active",
      createdAt: new Date(),
      discardedAt: null,
    };
    dbState.rows = [activeRow];

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("check_email")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            list: [
              { mail_id: "gm-99", mail_from: "verify@test.com", mail_subject: "Code: 112233", mail_date: "2026-10-31" },
            ],
          }),
        });
      }
      if (url.includes("fetch_email")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            mail_subject: "Code: 112233",
            mail_from: "verify@test.com",
            mail_body: "Your confirmation code is 112233",
            mail_date: "2026-10-31",
          }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    const poll = await pollInbox("user-1", "inbox-temp-1");
    expect(poll.code).toBe("112233");
    expect(poll.messages).toHaveLength(1);
    expect(poll.messages[0]?.code).toBe("112233");
    // Messages for tempmail are saved in DB
    expect(poll.stored).toBe(true);
    expect(dbState.insertedMessages).toHaveLength(1);
  });

  it("switches and activates a saved inbox", async () => {
    const savedRow = {
      id: "inbox-temp-2",
      userId: "user-1",
      provider: "tempmail",
      providerInboxId: "guerrilla:sid-token:test2@sharklasers.com",
      address: "test2@sharklasers.com",
      tier: "free",
      status: "saved",
      createdAt: new Date(),
      discardedAt: null,
    };
    dbState.rows = [savedRow];
    dbState.updateResult = [{ ...savedRow, status: "active" }];

    const activated = await activateInbox("user-1", "inbox-temp-2");
    expect(activated.status).toBe("active");
  });

  it("discards active tempmail inboxes", async () => {
    const activeRow = {
      id: "inbox-temp-1",
      userId: "user-1",
      provider: "tempmail",
      providerInboxId: "guerrilla:sid:demologin@sharklasers.com",
      address: "demologin@sharklasers.com",
      tier: "free",
      status: "active",
      createdAt: new Date(),
      discardedAt: null,
    };
    dbState.rows = [activeRow];
    dbState.updateResult = [activeRow];

    const discarded = await discardInbox("user-1", "inbox-temp-1");
    expect(discarded.status).toBe("discarded");
  });
});
