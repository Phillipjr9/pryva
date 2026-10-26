import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, hasDatabase } from "@/db";
import { walletTopups } from "@/db/schema";
import { getCurrentUser, isDemoUser } from "@/lib/auth";
import { isPaystackConfigured } from "@/lib/paystack";

export const dynamic = "force-dynamic";

const METHODS = new Set(["bank-transfer", "card"]);

type PaystackInitializeResponse = {
  status?: boolean;
  data?: {
    authorization_url?: string;
    access_code?: string;
    reference?: string;
  };
};

function makeTopupReference(): string {
  const timestamp = Date.now().toString(36).toUpperCase().slice(-5);
  const entropy = randomBytes(8).toString("hex").toUpperCase();
  return `TOP-${timestamp}${entropy}`;
}

function safeReturnTo(value: unknown, origin: string): string | null {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.length > 600) {
    return null;
  }
  try {
    const target = new URL(value, origin);
    if (target.origin !== origin) return null;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return null;
  }
}

function getCallbackUrl(request: Request, returnTo: string | null): string {
  const configured = process.env.PAYSTACK_CALLBACK_URL?.trim();
  const callback = configured
    ? new URL(configured)
    : new URL("/api/wallet/topup/callback", request.url);

  if (callback.pathname !== "/api/wallet/topup/callback") {
    throw new Error("PAYSTACK_CALLBACK_URL must point to /api/wallet/topup/callback");
  }
  if (process.env.NODE_ENV === "production" && callback.protocol !== "https:") {
    throw new Error("Paystack callbacks must use HTTPS in production");
  }
  if (returnTo) callback.searchParams.set("returnTo", returnTo);
  return callback.toString();
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return Response.json({ ok: false, error: "Please sign in first." }, { status: 401 });
  }
  if (!hasDatabase || isDemoUser(user)) {
    return Response.json(
      { ok: false, error: "Wallet funding is disabled for the read-only demo account." },
      { status: 503 },
    );
  }
  if (!isPaystackConfigured()) {
    return Response.json(
      { ok: false, error: "Paystack wallet funding is not configured on this deployment." },
      { status: 503 },
    );
  }

  let body: { amount?: unknown; method?: unknown; returnTo?: unknown };
  try {
    body = (await request.json()) as { amount?: unknown; method?: unknown; returnTo?: unknown };
  } catch {
    return Response.json({ ok: false, error: "Enter a valid top-up amount and payment method." }, { status: 400 });
  }

  const amount = Number(body.amount);
  const method = typeof body.method === "string" ? body.method : "";
  if (!Number.isSafeInteger(amount) || amount < 1000) {
    return Response.json({ ok: false, error: "The minimum top-up is ₦1,000." }, { status: 400 });
  }
  if (amount > 500000) {
    return Response.json(
      { ok: false, error: "The maximum top-up is ₦500,000." },
      { status: 400 },
    );
  }
  if (!METHODS.has(method)) {
    return Response.json({ ok: false, error: "Choose bank transfer or card." }, { status: 400 });
  }

  const requestOrigin = new URL(request.url).origin;
  const returnTo = body.returnTo === undefined ? null : safeReturnTo(body.returnTo, requestOrigin);
  if (body.returnTo !== undefined && body.returnTo !== null && body.returnTo !== "" && !returnTo) {
    return Response.json({ ok: false, error: "Invalid return path." }, { status: 400 });
  }

  const reference = makeTopupReference();
  let callbackUrl: string;
  try {
    callbackUrl = getCallbackUrl(request, returnTo);
  } catch {
    return Response.json(
      { ok: false, error: "Paystack callback URL is not configured correctly." },
      { status: 503 },
    );
  }

  try {
    await db.insert(walletTopups).values({
      reference,
      userId: user.id,
      amount,
      currency: "NGN",
      method,
      status: "pending",
    });

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY?.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: user.email,
        amount: amount * 100,
        currency: "NGN",
        reference,
        callback_url: callbackUrl,
        channels: method === "card" ? ["card"] : ["bank_transfer"],
        metadata: {
          purpose: "wallet_topup",
          walletTopupReference: reference,
          userId: user.id,
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    const result = (await response.json().catch(() => null)) as PaystackInitializeResponse | null;
    const authorizationUrl = result?.data?.authorization_url;
    const checkoutUrl = authorizationUrl ? new URL(authorizationUrl) : null;
    const validCheckoutUrl =
      checkoutUrl?.protocol === "https:" && checkoutUrl.hostname === "checkout.paystack.com";

    if (
      !response.ok ||
      !result?.status ||
      result.data?.reference !== reference ||
      !authorizationUrl ||
      !validCheckoutUrl
    ) {
      await db
        .update(walletTopups)
        .set({ status: "failed" })
        .where(and(eq(walletTopups.reference, reference), eq(walletTopups.status, "pending")));
      return Response.json(
        { ok: false, error: "We couldn't open Paystack checkout. Your wallet was not charged; please try again." },
        { status: 502 },
      );
    }

    await db
      .update(walletTopups)
      .set({ authorizationUrl })
      .where(eq(walletTopups.reference, reference));

    return Response.json({ ok: true, authorizationUrl, reference });
  } catch (error) {
    console.error("Paystack checkout initialization failed", error);
    await db
      .update(walletTopups)
      .set({ status: "failed" })
      .where(and(eq(walletTopups.reference, reference), eq(walletTopups.status, "pending")))
      .catch(() => undefined);

    return Response.json(
      { ok: false, error: "We couldn't open Paystack checkout. Your wallet was not charged; please try again." },
      { status: 502 },
    );
  }
}
