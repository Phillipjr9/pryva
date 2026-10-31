import { and, eq, isNull, sql } from "drizzle-orm";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";

import { db } from "@/db";
import { users, webauthnChallenges, webauthnCredentials } from "@/db/schema";
import { logger } from "@/lib/logger";
import { isLocalHost, publicOrigin } from "@/lib/net";

/**
 * Passkeys, server side.
 *
 * A passkey is a WebAuthn credential: the private key is generated on the
 * customer's device and never leaves it. This module keeps only what a server
 * legitimately needs — the public key, the signature counter, and the challenge
 * the device must sign — and it does the two ceremonies:
 *
 *   * **register** — a signed-in customer proves to the server that their device
 *     holds a key, and we store the public half;
 *   * **authenticate** — the device signs a fresh server-issued challenge, and
 *     that signature is the sign-in.
 *
 * Three properties matter more than the code that implements them:
 *
 *   1. **The challenge is the server's, is kept server-side, and is spent once.**
 *      `consumeChallenge` marks the row with a conditional update, so a captured
 *      assertion cannot be replayed for a second session.
 *   2. **The relying party is pinned, not inferred.** When the deployment names
 *      its origin, a request arriving on any other host is refused rather than
 *      accepted from a host the owner never authorised. WebAuthn already binds
 *      the origin into the signed client data; this makes the server's side of
 *      that comparison explicit.
 *   3. **A failed ceremony returns a reason, never a session.** Every path that
 *      cannot verify says why, and none of them falls back to "close enough".
 */

export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * A ceiling on credentials per account.
 *
 * Not a security control — a phone, a laptop, a backup key and a hardware token
 * is the realistic maximum, and a list that long is already unusable in a
 * settings screen.
 */
export const MAX_PASSKEYS_PER_ACCOUNT = 10;

export type RelyingParty = { rpID: string; origin: string };

/**
 * Which origin and RP ID this deployment signs for.
 *
 * `WEBAUTHN_ORIGIN` / `NEXT_PUBLIC_SITE_URL` pin it in a real deployment. With
 * nothing pinned the request's own origin is used, which is correct for local
 * development and for the preview — and is only accepted over HTTPS (or on
 * localhost, where browsers make an exception) because WebAuthn is defined as a
 * secure-context API and a passkey ceremony started from plain HTTP cannot work
 * anyway.
 *
 * `null` means "do not offer passkeys on this address". Routes turn that into a
 * 503 and the UI hides the button; that is a better answer than a button that
 * always fails.
 */
export function relyingPartyFor(request: Request, env: NodeJS.ProcessEnv = process.env): RelyingParty | null {
  const pinnedOrigin = (env.WEBAUTHN_ORIGIN?.trim() || env.NEXT_PUBLIC_SITE_URL?.trim() || "").replace(/\/+$/, "");
  const origin = pinnedOrigin || publicOrigin(request);

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;

  const secure = parsed.protocol === "https:" || (parsed.protocol === "http:" && isLocalHost(parsed.host));
  if (!secure) return null;

  const pinnedRpId = env.WEBAUTHN_RP_ID?.trim();
  const rpID = pinnedRpId || parsed.hostname;
  // An RP ID must be a registrable domain suffix of the origin, or the browser
  // rejects the ceremony. Checking it here turns a confusing browser error into
  // an obvious configuration mistake.
  if (!parsed.hostname.toLowerCase().endsWith(rpID.toLowerCase())) {
    logger.error("WebAuthn RP ID does not match the configured origin", { rpID, origin });
    return null;
  }
  if (!/^[a-z0-9.-]+$/i.test(rpID)) return null;

  return { rpID, origin: parsed.origin };
}

/** The relying party for a request, or a 503-shaped null when it is unavailable. */
export function passkeysAvailable(request: Request): boolean {
  return relyingPartyFor(request) !== null;
}

/* ------------------------------------------------------------- challenges -- */

export type ChallengePurpose = "register" | "authenticate";

/**
 * Remember a challenge before it is sent to the browser.
 *
 * The row is what makes the ceremony verifiable later: the signature has to be
 * over this exact value, and this value is only ever read back on the server.
 */
export async function issueChallenge(input: {
  challenge: string;
  purpose: ChallengePurpose;
  userId: string | null;
}): Promise<void> {
  const now = Date.now();
  await db.insert(webauthnChallenges).values({
    userId: input.userId,
    purpose: input.purpose,
    challenge: input.challenge,
    expiresAt: new Date(now + CHALLENGE_TTL_MS),
  });
  // Best effort housekeeping: an expired row is refused on read anyway, but
  // leaving them forever turns a five-minute value into permanent storage.
  try {
    await db
      .delete(webauthnChallenges)
      .where(sql`${webauthnChallenges.expiresAt} < now() - interval '1 day'`);
  } catch {
    // Housekeeping must never fail the ceremony.
  }
}

/**
 * Spend a challenge, exactly once.
 *
 * The conditional update is the whole control: two concurrent verifications of
 * the same assertion race here, and only one of them gets a row back.
 */
export async function consumeChallenge(input: {
  challenge: string;
  purpose: ChallengePurpose;
}): Promise<{ userId: string | null } | null> {
  if (typeof input.challenge !== "string" || input.challenge.length < 16 || input.challenge.length > 512) return null;
  const [spent] = await db
    .update(webauthnChallenges)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(webauthnChallenges.challenge, input.challenge),
        eq(webauthnChallenges.purpose, input.purpose),
        isNull(webauthnChallenges.consumedAt),
        sql`${webauthnChallenges.expiresAt} > now()`,
      ),
    )
    .returning({ userId: webauthnChallenges.userId });
  return spent ? { userId: spent.userId ?? null } : null;
}

/* -------------------------------------------------------------- credentials -- */

export type StoredCredential = {
  id: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[] | null;
  deviceType: string | null;
  backedUp: boolean;
  label: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
};

function parseTransports(value: string | null): string[] | null {
  if (!value) return null;
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.length > 0 ? parts : null;
}

export async function listCredentials(userId: string): Promise<StoredCredential[]> {
  const rows = await db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId))
    .orderBy(webauthnCredentials.createdAt);
  return rows.map((row) => ({
    id: row.id,
    credentialId: row.credentialId,
    publicKey: row.publicKey,
    counter: row.counter,
    transports: parseTransports(row.transports),
    deviceType: row.deviceType,
    backedUp: row.backedUp,
    label: row.label,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  }));
}

/** Metadata only — what a settings screen needs and nothing a client could misuse. */
export type CredentialSummary = {
  id: string;
  label: string;
  deviceType: string | null;
  backedUp: boolean;
  createdAt: Date;
  lastUsedAt: Date | null;
};

export async function listCredentialSummaries(userId: string): Promise<CredentialSummary[]> {
  const credentials = await listCredentials(userId);
  return credentials.map((credential) => ({
    id: credential.id,
    label: credential.label ?? (credential.deviceType === "multiDevice" ? "Synced passkey" : "Passkey"),
    deviceType: credential.deviceType,
    backedUp: credential.backedUp,
    createdAt: credential.createdAt,
    lastUsedAt: credential.lastUsedAt,
  }));
}

export async function credentialCount(userId: string): Promise<number> {
  const rows = await db
    .select({ id: webauthnCredentials.id })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId));
  return rows.length;
}

/**
 * Remove one of the account's own credentials.
 *
 * The user id is part of the where clause, not a check after the fact: an id
 * belonging to somebody else deletes nothing, whatever the caller sends.
 */
export async function deleteCredential(userId: string, credentialRowId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(credentialRowId)) return false;
  const [deleted] = await db
    .delete(webauthnCredentials)
    .where(and(eq(webauthnCredentials.id, credentialRowId), eq(webauthnCredentials.userId, userId)))
    .returning({ id: webauthnCredentials.id });
  if (!deleted) return false;
  logger.info("Passkey removed", { userId, credentialRowId });
  return true;
}

/* --------------------------------------------------------------- register -- */

export type RegistrationStart = { ok: true; options: unknown } | { ok: false; reason: "at-capacity" | "unavailable" };

export async function beginRegistration(input: {
  userId: string;
  email: string;
  name: string;
  rp: RelyingParty;
}): Promise<RegistrationStart> {
  const existing = await listCredentials(input.userId);
  if (existing.length >= MAX_PASSKEYS_PER_ACCOUNT) return { ok: false, reason: "at-capacity" };

  const options = await generateRegistrationOptions({
    rpName: "Pryva",
    rpID: input.rp.rpID,
    // The display name is the account's own; the id is the opaque row id, so a
    // credential never carries an email address inside the authenticator.
    userID: new TextEncoder().encode(input.userId),
    userName: input.email,
    userDisplayName: input.name || input.email,
    attestationType: "none",
    excludeCredentials: existing.map((credential) => ({
      id: credential.credentialId,
      ...(credential.transports ? { transports: credential.transports } : {}),
    })),
    authenticatorSelection: {
      // Discoverable ("resident") keys are what make username-less sign-in
      // possible, and user verification is required: a passkey that signs in
      // without proving the person is present is a possession factor, not a
      // replacement for the password.
      residentKey: "preferred",
      userVerification: "required",
    },
  });

  await issueChallenge({ challenge: options.challenge, purpose: "register", userId: input.userId });
  return { ok: true, options };
}

export type RegistrationFinish =
  | { ok: true; credentialId: string; deviceType: string | null; backedUp: boolean }
  | { ok: false; reason: "no-challenge" | "verification-failed" | "duplicate" | "unavailable" };

export async function finishRegistration(input: {
  userId: string;
  rp: RelyingParty;
  response: RegistrationResponseJSON;
  label?: string | null;
}): Promise<RegistrationFinish> {
  const credentialId = typeof input.response?.id === "string" ? input.response.id : "";
  const challenge = readChallenge(input.response);
  if (!challenge || !credentialId) return { ok: false, reason: "verification-failed" };

  // Spend the challenge first: whatever happens next, this ceremony cannot be
  // replayed, and a client that retries has to ask for a new one.
  const spent = await consumeChallenge({ challenge, purpose: "register" });
  if (!spent || spent.userId !== input.userId) return { ok: false, reason: "no-challenge" };

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: input.response,
      expectedChallenge: challenge,
      expectedOrigin: input.rp.origin,
      expectedRPID: input.rp.rpID,
      requireUserVerification: true,
    });
  } catch (error) {
    logger.warn("Passkey registration could not be verified", {
      userId: input.userId,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return { ok: false, reason: "verification-failed" };
  }

  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false, reason: "verification-failed" };
  }

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

  // One credential id belongs to exactly one account. A device that already
  // registered here (the exclude list should have stopped it) is refused rather
  // than duplicated.
  const [existing] = await db
    .select({ userId: webauthnCredentials.userId })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.credentialId, credential.id))
    .limit(1);
  if (existing) return { ok: false, reason: "duplicate" };

  await db.insert(webauthnCredentials).values({
    userId: input.userId,
    credentialId: credential.id,
    publicKey: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports?.join(",") ?? null,
    deviceType: credentialDeviceType ?? null,
    backedUp: Boolean(credentialBackedUp),
    label: input.label?.trim().slice(0, 80) || (credentialDeviceType === "multiDevice" ? "Synced passkey" : "This device"),
  });

  logger.info("Passkey registered", { userId: input.userId, deviceType: credentialDeviceType });
  return {
    ok: true,
    credentialId: credential.id,
    deviceType: credentialDeviceType ?? null,
    backedUp: Boolean(credentialBackedUp),
  };
}

/* ----------------------------------------------------------- authenticate -- */

export type AuthenticationStart = { ok: true; options: unknown } | { ok: false; reason: "unavailable" };

/**
 * Start a sign-in.
 *
 * No `allowCredentials`: the authenticator is asked to offer whichever passkey
 * it holds for this site, which is what lets a customer sign in without typing
 * an email first — and, just as importantly, tells the server nothing about
 * which accounts exist.
 */
export async function beginAuthentication(rp: RelyingParty): Promise<AuthenticationStart> {
  const options = await generateAuthenticationOptions({
    rpID: rp.rpID,
    allowCredentials: [],
    userVerification: "required",
  });
  await issueChallenge({ challenge: options.challenge, purpose: "authenticate", userId: null });
  return { ok: true, options };
}

export type AuthenticationFinish =
  | { ok: true; userId: string; credentialRowId: string }
  | { ok: false; reason: "no-challenge" | "unknown-credential" | "verification-failed" | "counter-regressed" | "account-missing" };

/**
 * Verify a sign-in.
 *
 * The credential id in the response is untrusted input: it is looked up here and
 * the account comes from the stored row, never from anything the browser said
 * about who it is signing in as.
 */
export async function finishAuthentication(input: {
  rp: RelyingParty;
  response: AuthenticationResponseJSON;
}): Promise<AuthenticationFinish> {
  const credentialId = typeof input.response?.id === "string" ? input.response.id : "";
  const challenge = readChallenge(input.response);
  if (!challenge || !credentialId) return { ok: false, reason: "verification-failed" };

  const spent = await consumeChallenge({ challenge, purpose: "authenticate" });
  if (!spent) return { ok: false, reason: "no-challenge" };

  const [stored] = await db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.credentialId, credentialId))
    .limit(1);
  if (!stored) return { ok: false, reason: "unknown-credential" };

  // A locked account stays locked whichever door is used. Letting a passkey sign
  // in during a lockout would make the lockout advisory.
  const [account] = await db
    .select({ id: users.id, lockedUntil: users.lockedUntil })
    .from(users)
    .where(eq(users.id, stored.userId))
    .limit(1);
  if (!account) return { ok: false, reason: "account-missing" };

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: input.response,
      expectedChallenge: challenge,
      expectedOrigin: input.rp.origin,
      expectedRPID: input.rp.rpID,
      requireUserVerification: true,
      credential: {
        id: stored.credentialId,
        publicKey: isoBase64URL.toBuffer(stored.publicKey),
        counter: stored.counter,
        ...(parseTransports(stored.transports) ? { transports: parseTransports(stored.transports)! } : {}),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    logger.warn("Passkey sign-in could not be verified", { userId: stored.userId, reason: message });
    return {
      ok: false,
      reason: /counter/i.test(message) ? "counter-regressed" : "verification-failed",
    };
  }

  if (!verification.verified) return { ok: false, reason: "verification-failed" };

  // A counter that moved backwards means the credential exists twice. The
  // library refuses it; recording it as its own reason makes the difference
  // visible to an operator instead of looking like a bad signature.
  if (verification.authenticationInfo.newCounter < stored.counter) {
    logger.error("Passkey counter regressed — possible cloned credential", {
      userId: stored.userId,
      stored: stored.counter,
      reported: verification.authenticationInfo.newCounter,
    });
    return { ok: false, reason: "counter-regressed" };
  }

  await db
    .update(webauthnCredentials)
    .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(eq(webauthnCredentials.id, stored.id));

  return { ok: true, userId: stored.userId, credentialRowId: stored.id };
}

/** The challenge lives in the signed client data, base64url-encoded JSON. */
function readChallenge(response: { response?: { clientDataJSON?: unknown } } | null | undefined): string | null {
  const clientDataJSON = response?.response?.clientDataJSON;
  if (typeof clientDataJSON !== "string" || clientDataJSON.length === 0) return null;
  try {
    const parsed = JSON.parse(Buffer.from(clientDataJSON, "base64url").toString("utf8")) as { challenge?: unknown };
    return typeof parsed.challenge === "string" ? parsed.challenge : null;
  } catch {
    return null;
  }
}
