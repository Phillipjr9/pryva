import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";

import * as schema from "@/db/schema";
import { users, webauthnChallenges, webauthnCredentials } from "@/db/schema";

/**
 * The passkey ceremonies, tested where this codebase can get them wrong.
 *
 * The cryptography is @simplewebauthn's and is mocked here on purpose: what
 * belongs to *this* application is the orchestration around it — issuing a
 * challenge that only the server knows, spending it exactly once, binding a
 * credential to the right account, refusing a counter that went backwards, and
 * never issuing a session on a path that did not verify. Those are the failures
 * that would matter, and they are all exercised below against a real database.
 */

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/logger", () => ({ logger: mocks.log }));
vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: mocks.generateRegistrationOptions,
  verifyRegistrationResponse: mocks.verifyRegistrationResponse,
  generateAuthenticationOptions: mocks.generateAuthenticationOptions,
  verifyAuthenticationResponse: mocks.verifyAuthenticationResponse,
}));

const USER = "3f1c6a2b-9d4e-4a7c-8b1f-2e5d6c7b8a90";
const OTHER = "7a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";
const CHALLENGE = "challenge-value-that-the-device-signs-0001";

const RP = { rpID: "pryva.ng", origin: "https://pryva.ng" };

let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
let passkeys: typeof import("@/lib/passkeys");

/** A response whose clientDataJSON carries the challenge the server issued. */
function responseFor(challenge: string, credentialId: string) {
  const clientDataJSON = Buffer.from(
    JSON.stringify({"type": "webauthn.get", challenge, origin: RP.origin}),
    "utf8",
  ).toString("base64url");
  return {
    id: credentialId,
    rawId: credentialId,
    type: "public-key" as const,
    clientExtensionResults: {},
    response: {
      clientDataJSON,
      authenticatorData: "YXV0aGVudGljYXRvckRhdGE",
      signature: "c2lnbmF0dXJl",
      userHandle: null,
    },
  };
}

beforeAll(async () => {
  pg = new PGlite();
  const files = (await readdir("migrations")).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
  for (const file of files) await pg.exec(await readFile(`migrations/${file}`, "utf8"));
  database = drizzle(pg, { schema });
  mocks.db = database;
  passkeys = await import("@/lib/passkeys");
}, 30_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(async () => {
  vi.clearAllMocks();
  await database.execute(sql`TRUNCATE TABLE webauthn_challenges, webauthn_credentials, users CASCADE`);
  await database.insert(users).values([
    { id: USER, name: "Ada", email: "ada@example.com", passwordHash: "x", walletBalance: 0 },
    { id: OTHER, name: "Bola", email: "bola@example.com", passwordHash: "x", walletBalance: 0 },
  ]);
  mocks.generateAuthenticationOptions.mockResolvedValue({ challenge: CHALLENGE, rpId: RP.rpID, allowCredentials: [] });
  mocks.generateRegistrationOptions.mockResolvedValue({ challenge: CHALLENGE, rp: { id: RP.rpID, name: "Pryva" } });
});

describe("the relying party", () => {
  // Mirrors a real hop: the gateway tells the app which protocol it terminated.
  const request = (url: string) => {
    const parsed = new URL(url);
    return new Request(url, {
      headers: {
        host: parsed.host,
        "x-forwarded-host": parsed.host,
        "x-forwarded-proto": parsed.protocol.replace(":", ""),
      },
    });
  };

  it("is pinned by configuration when the deployment names its origin", () => {
    const env = { NEXT_PUBLIC_SITE_URL: "https://pryva.ng" } as unknown as NodeJS.ProcessEnv;
    expect(passkeys.relyingPartyFor(request("https://preview.example.com/"), env)).toEqual({
      rpID: "pryva.ng",
      origin: "https://pryva.ng",
    });
  });

  it("allows localhost over http, because browsers do", () => {
    const env = {} as unknown as NodeJS.ProcessEnv;
    expect(passkeys.relyingPartyFor(request("http://localhost:3000/"), env)).toEqual({
      rpID: "localhost",
      origin: "http://localhost:3000",
    });
  });

  it("refuses plain http on a real host", () => {
    const env = {} as unknown as NodeJS.ProcessEnv;
    expect(passkeys.relyingPartyFor(request("http://pryva.ng/"), env)).toBeNull();
  });

  it("refuses an RP ID that is not a suffix of the origin", () => {
    const env = { WEBAUTHN_ORIGIN: "https://pryva.ng", WEBAUTHN_RP_ID: "example.com" } as unknown as NodeJS.ProcessEnv;
    expect(passkeys.relyingPartyFor(request("https://pryva.ng/"), env)).toBeNull();
  });

  it("accepts the arena preview host over https", () => {
    const env = {} as unknown as NodeJS.ProcessEnv;
    const host = "3000-abc123.e2b.app";
    const rp = passkeys.relyingPartyFor(new Request(`https://${host}/`, {
      headers: { host, "x-forwarded-host": host, "x-forwarded-proto": "https" },
    }), env);
    expect(rp).toEqual({ rpID: host, origin: `https://${host}` });
  });
});

describe("the challenge", () => {
  it("is server-side, single use, and bound to its purpose", async () => {
    await passkeys.beginAuthentication(RP);

    const first = await passkeys.consumeChallenge({ challenge: CHALLENGE, purpose: "authenticate" });
    expect(first).not.toBeNull();
    // The same signed value cannot buy a second session.
    expect(await passkeys.consumeChallenge({ challenge: CHALLENGE, purpose: "authenticate" })).toBeNull();
  });

  it("cannot be redirected from a registration into a sign-in", async () => {
    await passkeys.issueChallenge({ challenge: CHALLENGE, purpose: "register", userId: USER });
    expect(await passkeys.consumeChallenge({ challenge: CHALLENGE, purpose: "authenticate" })).toBeNull();
  });

  it("expires", async () => {
    await database.insert(webauthnChallenges).values({
      purpose: "authenticate",
      challenge: "expired-challenge-value-abcdefghij",
      expiresAt: new Date(Date.now() - 1_000),
    });
    expect(
      await passkeys.consumeChallenge({ challenge: "expired-challenge-value-abcdefghij", purpose: "authenticate" }),
    ).toBeNull();
  });
});

describe("signing in with a passkey", () => {
  async function seedCredential(counter = 0, userId = USER) {
    await database.insert(webauthnCredentials).values({
      userId,
      credentialId: "credential-id-abc",
      publicKey: "cHVibGljLWtleQ",
      counter,
      deviceType: "singleDevice",
      backedUp: false,
      label: "This device",
    });
  }

  it("returns the account that owns the credential, and advances the counter", async () => {
    await seedCredential(4);
    await passkeys.issueChallenge({ challenge: CHALLENGE, purpose: "authenticate", userId: null });
    mocks.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 5, credentialID: "credential-id-abc", userVerified: true },
    });

    const result = await passkeys.finishAuthentication({
      rp: RP,
      response: responseFor(CHALLENGE, "credential-id-abc") as never,
    });

    expect(result).toEqual({ ok: true, userId: USER, credentialRowId: expect.any(String) });
    const [stored] = await database.select().from(webauthnCredentials);
    expect(stored.counter).toBe(5);
    expect(stored.lastUsedAt).toBeTruthy();
  });

  it("refuses an unknown credential without touching anything", async () => {
    await passkeys.issueChallenge({ challenge: CHALLENGE, purpose: "authenticate", userId: null });
    const result = await passkeys.finishAuthentication({
      rp: RP,
      response: responseFor(CHALLENGE, "not-a-real-credential") as never,
    });
    expect(result).toEqual({ ok: false, reason: "unknown-credential" });
    expect(mocks.verifyAuthenticationResponse).not.toHaveBeenCalled();
  });

  it("refuses when the signature does not verify", async () => {
    await seedCredential();
    await passkeys.issueChallenge({ challenge: CHALLENGE, purpose: "authenticate", userId: null });
    mocks.verifyAuthenticationResponse.mockResolvedValue({ verified: false, authenticationInfo: {} });

    const result = await passkeys.finishAuthentication({
      rp: RP,
      response: responseFor(CHALLENGE, "credential-id-abc") as never,
    });
    expect(result).toEqual({ ok: false, reason: "verification-failed" });
    const [stored] = await database.select().from(webauthnCredentials);
    expect(stored.counter).toBe(0);
  });

  it("reports a counter that went backwards as its own failure", async () => {
    await seedCredential(9);
    await passkeys.issueChallenge({ challenge: CHALLENGE, purpose: "authenticate", userId: null });
    mocks.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 3, credentialID: "credential-id-abc", userVerified: true },
    });

    const result = await passkeys.finishAuthentication({
      rp: RP,
      response: responseFor(CHALLENGE, "credential-id-abc") as never,
    });
    expect(result).toEqual({ ok: false, reason: "counter-regressed" });
    // The stored counter is not moved backwards by the refusal.
    const [stored] = await database.select().from(webauthnCredentials);
    expect(stored.counter).toBe(9);
  });

  it("needs a challenge that this server issued, in this ceremony", async () => {
    await seedCredential();
    mocks.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 1, credentialID: "credential-id-abc", userVerified: true },
    });

    const result = await passkeys.finishAuthentication({
      rp: RP,
      response: responseFor("a-challenge-nobody-issued-000000", "credential-id-abc") as never,
    });
    expect(result).toEqual({ ok: false, reason: "no-challenge" });
    expect(mocks.verifyAuthenticationResponse).not.toHaveBeenCalled();
  });
});

describe("adding a passkey", () => {
  it("stores the public half against the signed-in account", async () => {
    await passkeys.issueChallenge({ challenge: CHALLENGE, purpose: "register", userId: USER });
    mocks.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: { id: "new-credential", publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ["internal"] },
        credentialDeviceType: "multiDevice",
        credentialBackedUp: true,
      },
    });

    const result = await passkeys.finishRegistration({
      userId: USER,
      rp: RP,
      response: responseFor(CHALLENGE, "new-credential") as never,
      label: "My phone",
    });

    expect(result).toMatchObject({ ok: true, deviceType: "multiDevice", backedUp: true });
    const [stored] = await database.select().from(webauthnCredentials);
    expect(stored.userId).toBe(USER);
    expect(stored.label).toBe("My phone");
    expect(stored.transports).toBe("internal");
    // base64url of [1,2,3] — no padding, no `+` or `/`.
    expect(stored.publicKey).toBe("AQID");
  });

  it("refuses a challenge that belonged to a different account", async () => {
    await passkeys.issueChallenge({ challenge: CHALLENGE, purpose: "register", userId: OTHER });
    const result = await passkeys.finishRegistration({
      userId: USER,
      rp: RP,
      response: responseFor(CHALLENGE, "cred") as never,
    });
    expect(result).toEqual({ ok: false, reason: "no-challenge" });
    expect(mocks.verifyRegistrationResponse).not.toHaveBeenCalled();
  });

  it("refuses the same device twice", async () => {
    await database.insert(webauthnCredentials).values({
      userId: OTHER,
      credentialId: "shared-device",
      publicKey: "AQID",
      counter: 0,
    });
    await passkeys.issueChallenge({ challenge: CHALLENGE, purpose: "register", userId: USER });
    mocks.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: { id: "shared-device", publicKey: new Uint8Array([1]), counter: 0 },
        credentialDeviceType: "singleDevice",
        credentialBackedUp: false,
      },
    });

    const result = await passkeys.finishRegistration({
      userId: USER,
      rp: RP,
      response: responseFor(CHALLENGE, "shared-device") as never,
    });
    expect(result).toEqual({ ok: false, reason: "duplicate" });
    expect(await database.select().from(webauthnCredentials)).toHaveLength(1);
  });

  it("stops at ten", async () => {
    await database.insert(webauthnCredentials).values(
      Array.from({ length: 10 }, (_, index) => ({
        userId: USER,
        credentialId: `credential-${index}`,
        publicKey: "AQID",
        counter: 0,
      })),
    );
    const result = await passkeys.beginRegistration({ userId: USER, email: "ada@example.com", name: "Ada", rp: RP });
    expect(result).toEqual({ ok: false, reason: "at-capacity" });
    expect(mocks.generateRegistrationOptions).not.toHaveBeenCalled();
  });
});

describe("removing a passkey", () => {
  it("only removes the account's own", async () => {
    await database.insert(webauthnCredentials).values({
      userId: OTHER,
      credentialId: "bola-credential",
      publicKey: "AQID",
      counter: 0,
    });
    const [row] = await database.select().from(webauthnCredentials);

    expect(await passkeys.deleteCredential(USER, row.id)).toBe(false);
    expect(await database.select().from(webauthnCredentials)).toHaveLength(1);

    expect(await passkeys.deleteCredential(OTHER, row.id)).toBe(true);
    expect(await database.select().from(webauthnCredentials)).toHaveLength(0);
  });

  it("ignores a malformed id", async () => {
    expect(await passkeys.deleteCredential(USER, "not-a-uuid")).toBe(false);
  });
});
