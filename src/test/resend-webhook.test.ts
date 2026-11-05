import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  normaliseEventName,
  recipientDomain,
  resendOutcome,
  verifyResendSignature,
} from "@/lib/email/resend-webhook";

/**
 * Resend signs through Svix, and the scheme has several ways to be wrong while
 * looking right. Each of those is a test here, because a verifier that accepts
 * everything turns the endpoint into a way for anyone to fabricate bounces, and a
 * verifier that rejects everything looks from the outside exactly like a webhook
 * that was never configured.
 */
const KEY = Buffer.from("a".repeat(32));
const SECRET = `whsec_${KEY.toString("base64")}`;
const BODY = JSON.stringify({ type: "email.delivered", data: { email_id: "abc" } });
const T0 = 1_700_000_000; // seconds

function sign(id: string, timestamp: number, body: string, key = KEY): string {
  return createHmac("sha256", key)
    .update(`${id}.${timestamp}.${body}`, "utf8")
    .digest("base64");
}

function verify(overrides: Partial<Parameters<typeof verifyResendSignature>[0]> = {}) {
  return verifyResendSignature({
    body: BODY,
    id: "msg_1",
    timestamp: String(T0),
    signature: `v1,${sign("msg_1", T0, BODY)}`,
    secret: SECRET,
    now: T0 * 1000,
    ...overrides,
  });
}

describe("a genuine delivery is accepted", () => {
  it("verifies the documented construction", () => {
    expect(verify()).toBe(true);
  });

  it("accepts a match in any position, which is what rotation looks like", () => {
    // A secret being rotated sends several signatures; a non-matching first entry
    // must not end the search.
    expect(verify({ signature: `v1,bogus v1,${sign("msg_1", T0, BODY)}` })).toBe(true);
  });
});

describe("forgeries are refused", () => {
  it("rejects a signature made with the wrong key", () => {
    const wrongKey = Buffer.from("b".repeat(32));
    expect(verify({ signature: `v1,${sign("msg_1", T0, BODY, wrongKey)}` })).toBe(false);
  });

  it("rejects a body changed after signing", () => {
    expect(verify({ body: JSON.stringify({ type: "email.bounced" }) })).toBe(false);
  });

  it("rejects a re-serialised body, the mistake this pins", () => {
    // Exactly what `JSON.parse` then `JSON.stringify` would produce: same data,
    // different bytes. An endpoint that verifies after parsing rejects every
    // genuine delivery.
    const reserialised = JSON.stringify(JSON.parse(BODY));
    const spaced = BODY.replace(":", ": ");
    expect(spaced).not.toBe(reserialised);
    expect(verify({ body: reserialised })).toBe(true); // same bytes here
    expect(verify({ body: spaced })).toBe(false);
  });

  it("rejects a tampered timestamp", () => {
    expect(verify({ timestamp: String(T0 + 1) })).toBe(false);
  });

  it("rejects a tampered message id", () => {
    expect(verify({ id: "msg_2" })).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verify({ id: null })).toBe(false);
    expect(verify({ timestamp: null })).toBe(false);
    expect(verify({ signature: null })).toBe(false);
  });

  it("rejects a version other than v1", () => {
    expect(verify({ signature: `v2,${sign("msg_1", T0, BODY)}` })).toBe(false);
  });

  it("rejects a secret without the whsec_ prefix", () => {
    expect(verify({ secret: KEY.toString("base64") })).toBe(false);
  });

  it("rejects an empty key rather than signing against nothing", () => {
    expect(verify({ secret: "whsec_" })).toBe(false);
  });
});

describe("the replay window", () => {
  it("accepts a delivery signed moments ago", () => {
    expect(verify({ now: (T0 + 60) * 1000 })).toBe(true);
  });

  it("rejects a captured delivery replayed after the window", () => {
    expect(verify({ now: (T0 + 5 * 60 + 1) * 1000 })).toBe(false);
  });

  it("rejects a timestamp from the future, which would stretch the window", () => {
    expect(verify({ now: (T0 - 6 * 60) * 1000 })).toBe(false);
  });
});

describe("event mapping", () => {
  it("records the events that matter to a delivery record", () => {
    expect(resendOutcome("email.delivered")).toBe("delivered");
    expect(resendOutcome("email.bounced")).toBe("bounced");
    expect(resendOutcome("email.complained")).toBe("complained");
  });

  it("drops event types with no use rather than inventing an outcome", () => {
    expect(resendOutcome("email.delivery_delayed")).toBe("ignored");
    expect(resendOutcome("contact.created")).toBe("ignored");
    expect(resendOutcome(undefined)).toBe("ignored");
  });

  it("bounds the event name, which comes from the sender", () => {
    expect(normaliseEventName("email.delivered")).toBe("email.delivered");
    expect(normaliseEventName("x".repeat(61))).toBeNull();
    expect(normaliseEventName("   ")).toBeNull();
    expect(normaliseEventName(42)).toBeNull();
  });
});

describe("recipient handling", () => {
  it("keeps the domain and never the mailbox", () => {
    expect(recipientDomain("customer@Gmail.com")).toBe("gmail.com");
    expect(recipientDomain("a.b+c@sub.example.co.uk")).toBe("sub.example.co.uk");
  });

  it("refuses anything malformed", () => {
    expect(recipientDomain("no-at-sign")).toBeNull();
    expect(recipientDomain("trailing@")).toBeNull();
    expect(recipientDomain("bad@do main")).toBeNull();
    expect(recipientDomain(null)).toBeNull();
  });
});
