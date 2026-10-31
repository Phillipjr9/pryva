import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cancelTempMail,
  checkTempMail,
  createTempMailInbox,
  extractVerificationCode,
  isTempMailConfigured,
  TempMailError,
} from "@/lib/tempmail";
import {
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
}));

vi.mock("@/db", () => {
  const thenable = (rows: () => Record<string, unknown>[]) => ({
    then: (resolve: (value: Record<string, unknown>[]) => unknown) => Promise.resolve(rows()).then(resolve),
    limit: async (n: number) => rows().slice(0, n),
    orderBy: () => thenable(rows),
  });

  const db = {
    insert: () => ({
      values: (val: unknown) => ({
        returning: async () => {
          const row = {
            id: "inbox-temp-1",
            ...(val as Record<string, unknown>),
            createdAt: new Date("2026-10-31T12:00:00Z"),
            discardedAt: null,
          };
          dbState.rows = [row];
          return [row];
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => thenable(() => dbState.rows),
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
    expect(inbox.address).toMatch(/^[0-9a-f]{10}@(1secmail\.(com|net|org))$/);
    expect(inbox.domain).toMatch(/^1secmail\.(com|net|org)$/);
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
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("polls and formats incoming messages with extracted codes", async () => {
    const mockList = [{ id: 101, from: "auth@service.com", subject: "Verification Code", date: "2026-10-31 12:00:00" }];
    const mockDetail = {
      id: 101,
      from: "auth@service.com",
      subject: "Verification Code",
      date: "2026-10-31 12:00:00",
      body: "Your verification code is 591024",
      textBody: "Your verification code is 591024",
    };

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("action=getMessages")) {
        return Promise.resolve({ ok: true, json: async () => mockList });
      }
      if (url.includes("action=readMessage")) {
        return Promise.resolve({ ok: true, json: async () => mockDetail });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });

    const result = await checkTempMail("testlogin:1secmail.com");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      from: "auth@service.com",
      subject: "Verification Code",
      body: "Your verification code is 591024",
      code: "591024",
    });
    expect(result.code).toBe("591024");
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
    expect(created.address).toContain("@1secmail.");
    expect(created.tier).toBe("free");
    expect(created.status).toBe("active");
  });

  it("polls and returns live messages for tempmail inboxes", async () => {
    dbState.rows = [
      {
        id: "inbox-temp-1",
        userId: "user-1",
        provider: "tempmail",
        providerInboxId: "demologin:1secmail.com",
        address: "demologin@1secmail.com",
        tier: "free",
        status: "active",
        createdAt: new Date(),
        discardedAt: null,
      },
    ];

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("action=getMessages")) {
        return Promise.resolve({
          ok: true,
          json: async () => [{ id: 42, from: "no-reply@app.test", subject: "Code: 998877", date: "2026-10-31" }],
        });
      }
      if (url.includes("action=readMessage")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            id: 42,
            from: "no-reply@app.test",
            subject: "Code: 998877",
            body: "Your confirmation code is 998877",
            textBody: "Your confirmation code is 998877",
          }),
        });
      }
      return Promise.resolve({ ok: false });
    });

    const poll = await pollInbox("user-1", "inbox-temp-1");
    expect(poll.code).toBe("998877");
    expect(poll.messages).toHaveLength(1);
    expect(poll.messages[0]?.code).toBe("998877");
    expect(poll.stored).toBe(false);
  });

  it("discards active tempmail inboxes", async () => {
    const activeRow = {
      id: "inbox-temp-1",
      userId: "user-1",
      provider: "tempmail",
      providerInboxId: "demologin:1secmail.com",
      address: "demologin@1secmail.com",
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
